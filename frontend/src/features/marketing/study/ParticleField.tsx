import { useEffect, useLayoutEffect, useRef } from "react";
import * as THREE from "three";
import {
  createScatter,
  createShape,
  particleIdentity,
  particleSeed,
  smoothProgress,
  shapeScrollAnchor,
  ambientParticleCount,
  MAX_AMBIENT_MULTIPLIER,
  type Shape,
} from "./geometry";
import {
  advanceGlyphMotion,
  curveCarry,
  type PointerStroke,
} from "./interaction";
import { authContour, readingBounds, type AuthBounds } from "../public/authComposition";

export interface ParticleScene {
  root: HTMLElement;
  composition: "story" | "ambient" | "auth";
}
interface Props {
  root: HTMLElement;
  light: boolean;
  count: number;
  composition?: "story" | "ambient" | "auth";
  scene?: ParticleScene | null;
  onStatus: (status: "loading" | "ready" | "unavailable") => void;
}

// Original shader: no reference-site implementation or art is copied.
const vertexShader = `
  attribute vec3 readShape;
  attribute vec3 askShape;
  attribute vec3 checkShape;
  attribute vec3 scatter;
  attribute vec3 authShape;
  attribute float seed;
  attribute vec2 identity;
  attribute float background;
  attribute vec2 displacement;
  uniform vec4 weights;
  uniform float spread;
  uniform float authMix;
  uniform vec2 viewport;
  uniform float clock;
  uniform float scale;
  uniform float dpr;
  uniform vec2 center;
  uniform vec2 pointer;
  uniform vec2 tilt;
  uniform float pointerActive;
  uniform float scrollOffset;
  uniform vec2 atmosphereShift;
  varying float brightness;
  varying float glyphIndex;
  varying float spectrum;
  varying float ambientGlyph;
  void main() {
    vec3 p = position * weights.x + readShape * weights.y + askShape * weights.z + checkShape * weights.w;
    p = mix(p, authShape, authMix);
    float yaw = sin(clock * .16) * .035 + tilt.x;
    float pitch = tilt.y;
    p = vec3(p.x*cos(yaw)+p.z*sin(yaw), p.y, -p.x*sin(yaw)+p.z*cos(yaw));
    p = vec3(p.x, p.y*cos(pitch)-p.z*sin(pitch), p.y*sin(pitch)+p.z*cos(pitch));
    p.xy *= scale;
    p.xy += center;
    vec2 dispersed = scatter.xy * viewport * .5;
    dispersed += vec2(sin(clock*.13+seed*23.0)*8.0,cos(clock*.10+seed*19.0)*6.0);
    dispersed += atmosphereShift*(.3+seed*.7);
    p.xy = mix(p.xy, dispersed, spread);
    if (background > .5) {
      // A persistent distant field never participates in shape assembly.
      // Wrap beyond the viewport; only a small fraction of page scroll becomes parallax.
      p.x = scatter.x * viewport.x * .5 + sin(clock*.16+seed*20.0)*10.0 + atmosphereShift.x*(.4+seed*.6);
      p.y = mod(scatter.y*viewport.y*.5 + scrollOffset*(.025+seed*.035)
        + cos(clock*.12+seed*15.0)*7.0 + atmosphereShift.y*(.4+seed*.6)
        + viewport.y*.6, viewport.y*1.2)-viewport.y*.6;
      p.z = -.4;
    }
    p.xy += displacement;
    p.z *= scale;
    brightness = .4 + .6 * seed;
    glyphIndex = floor(identity.x * 7.999);
    spectrum = identity.y;
    ambientGlyph = background;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0);
    // A long-tailed size distribution, not a field of equal-size text icons:
    // tiny distant fragments, readable mid-size glyphs, rare luminous anchors.
    float foregroundSize = 4.0 + pow(seed,2.0)*13.0 + pow(seed,24.0)*28.0;
    // Compact sculptures need smaller glyphs, not overlapping desktop sprites.
    // Dispersed particles retain their established varied sizes.
    foregroundSize *= mix(clamp(scale / 160.0, .35, 1.0), 1.0, spread);
    float backgroundSize = 2.0 + pow(seed,2.0)*5.0 + pow(seed,24.0)*7.0;
    gl_PointSize = mix(foregroundSize,backgroundSize,background) * dpr;
  }
`;
const fragmentShader = `
  uniform vec3 tint;
  uniform float opacity;
  uniform sampler2D glyphAtlas;
  uniform float highlight;
  varying float brightness;
  varying float glyphIndex;
  varying float spectrum;
  varying float ambientGlyph;
  void main() {
    vec2 uv = vec2((glyphIndex + gl_PointCoord.x) / 8.0, 1.0-gl_PointCoord.y);
    float alpha = texture2D(glyphAtlas, uv).a * brightness * mix(opacity,.42,ambientGlyph);
    if(alpha<.01) discard;
    // Stable spectral identity: predominantly ice, with warm and violet accents.
    // The page stays neutral; the glyphs carry the color and light.
    vec3 spectral = spectrum < .52 ? vec3(.46,.77,1.0)
      : spectrum < .74 ? vec3(1.0,.62,.34)
      : spectrum < .89 ? vec3(.72,.59,1.0) : vec3(.88,.97,1.0);
    vec3 color = mix(tint, spectral, highlight);
    gl_FragColor = vec4(mix(color, vec3(1.0), pow(brightness,10.0)*highlight*.7),alpha);
  }
`;

export default function ParticleField({
  root,
  light,
  count,
  onStatus,
  composition: initialComposition = "story",
  scene: sceneDescriptor,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const descriptor = useRef(sceneDescriptor);
  const changeScene = useRef<((scene: ParticleScene | null | undefined) => void) | null>(null);
  useLayoutEffect(() => {
    descriptor.current = sceneDescriptor;
    changeScene.current?.(sceneDescriptor);
  }, [sceneDescriptor]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    onStatus("loading");
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: false,
        powerPreference: "low-power",
      });
    } catch {
      onStatus("unavailable");
      return;
    }
    element.appendChild(renderer.domElement);
    let composition = descriptor.current?.composition ?? initialComposition;
    let sceneRoot = descriptor.current === undefined ? root : descriptor.current?.root ?? null;
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
    camera.position.z = 1000;
    const geometry = new THREE.BufferGeometry();
    // Allocate a bounded pool once. Resizing changes only the draw range,
    // preserving the renderer, particle identities and keyboard focus.
    const total = count + Math.round(count * 1.5 * MAX_AMBIENT_MULTIPLIER);
    let activeTotal = count;
    const shapes = Object.fromEntries(
      (["code", "read", "ask", "check"] as Shape[]).map((s) => {
        const positions = new Float32Array(total * 3);
        positions.set(createShape(s, count));
        return [s, positions];
      }),
    ) as Record<Shape, Float32Array>;
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(shapes.code, 3),
    );
    geometry.setAttribute(
      "readShape",
      new THREE.BufferAttribute(shapes.read, 3),
    );
    geometry.setAttribute("askShape", new THREE.BufferAttribute(shapes.ask, 3));
    geometry.setAttribute(
      "checkShape",
      new THREE.BufferAttribute(shapes.check, 3),
    );
    const scattered = new Float32Array(total * 3);
    scattered.set(createScatter(count));
    for (let i = count; i < total; i++) {
      scattered[i * 3] = particleSeed(i * 3) * 2 - 1;
      scattered[i * 3 + 1] = particleSeed(i * 3 + 1) * 2.4 - 1.2;
    }
    geometry.setAttribute("scatter", new THREE.BufferAttribute(scattered, 3));
    const authPoints = new Float32Array(total * 3);
    const authTarget = new Float32Array(total * 3);
    geometry.setAttribute("authShape", new THREE.BufferAttribute(authPoints, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute(
      "seed",
      new THREE.BufferAttribute(
        Float32Array.from({ length: total }, (_, i) => particleSeed(i)),
        1,
      ),
    );
    geometry.setAttribute(
      "identity",
      new THREE.BufferAttribute(
        Float32Array.from(
          Array.from({ length: total }, (_, i) => particleIdentity(i)).flat(),
        ),
        2,
      ),
    );
    geometry.setAttribute(
      "background",
      new THREE.BufferAttribute(
        Float32Array.from({ length: total }, (_, i) => (i >= count ? 1 : 0)),
        1,
      ),
    );
    const offsets = new Float32Array(total * 2);
    const velocities = new Float32Array(total * 2);
    const displacement = new THREE.BufferAttribute(offsets, 2).setUsage(
      THREE.DynamicDrawUsage,
    );
    geometry.setAttribute("displacement", displacement);
    // One original code-symbol atlas, not hundreds of animated DOM text nodes.
    const atlasCanvas = document.createElement("canvas");
    atlasCanvas.width = 512;
    atlasCanvas.height = 64;
    const context = atlasCanvas.getContext("2d");
    if (!context) {
      renderer.dispose();
      renderer.domElement.remove();
      geometry.dispose();
      onStatus("unavailable");
      return;
    }
    context.font = "500 44px monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "#ffffff";
    context.shadowColor = "#ffffff";
    context.shadowBlur = light ? 0 : 7;
    ["{", "}", "<", ">", "[", "]", ";", "+"].forEach((glyph, i) =>
      context.fillText(glyph, i * 64 + 32, 33),
    );
    const atlas = new THREE.CanvasTexture(atlasCanvas);
    atlas.minFilter = THREE.LinearFilter;
    atlas.magFilter = THREE.LinearFilter;
    atlas.generateMipmaps = false;
    const uniforms = {
      atmosphereShift: { value: new THREE.Vector2() },
      scrollOffset: { value: 0 },
      tilt: { value: new THREE.Vector2() },
      glyphAtlas: { value: atlas },
      highlight: { value: light ? 0 : 1 },
      weights: { value: new THREE.Vector4(1, 0, 0, 0) },
      spread: { value: composition === "auth" || composition === "ambient" ? 0 : 1 },
      authMix: { value: composition === "auth" || composition === "ambient" ? 1 : 0 },
      viewport: { value: new THREE.Vector2() },
      clock: { value: 0 },
      scale: { value: 180 },
      dpr: { value: 1 },
      center: { value: new THREE.Vector2() },
      pointer: { value: new THREE.Vector2(-10000, -10000) },
      pointerActive: { value: 0 },
      tint: { value: new THREE.Color(light ? "#086b91" : "#82d6fa") },
      opacity: { value: 1 },
    };
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: light ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    scene.add(points);
    let width = innerWidth,
      height = innerHeight,
      frame = 0,
      last = 0,
      elapsed = 0,
      disposed = false,
      ready = false,
      contextLost = false;
    let pointerTarget = 0;
    const pointerPosition = new THREE.Vector2(-10000, -10000);
    const strokes: PointerStroke[] = [];
    let previousPointer: { x: number; y: number; time: number } | null = null;
    let previousStroke: PointerStroke | null = null;
    const tiltTarget = new THREE.Vector2();
    let drag: {
      id: number;
      x: number;
      y: number;
      element: HTMLElement;
    } | null = null;
    let anchors: HTMLElement[] = [];
    let authCenter = { x: 0, pageY: 0 };
    let authContent: HTMLElement | null = null;
    let authBounds: AuthBounds | null = null;
    const authScratch = new Float32Array(count * 3);
    const measureAuth = () => {
      if (!authContent || disposed) return;
      const measured = authContent.getBoundingClientRect();
      const rect = composition === "ambient" ? readingBounds(width, height, measured.width) : measured;
      authBounds = rect;
      const contour = authContour(count, width, rect, elapsed, authScratch);
      for (let i = 0; i < contour.length; i++) authTarget[i] = contour[i]! / 200;
      if (!ready) authPoints.set(authTarget);
      authCenter = { x: rect.left + rect.width / 2 - width / 2,
        pageY: rect.top + scrollY + rect.height / 2 };
    };
    const resize = () => {
      width = innerWidth;
      height = innerHeight;
      activeTotal = count + ambientParticleCount(width, height, count);
      geometry.setDrawRange(0, activeTotal);
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
      renderer.setSize(width, height);
      uniforms.viewport.value.set(width, height);
      uniforms.dpr.value = renderer.getPixelRatio();
      camera.left = -width / 2;
      camera.right = width / 2;
      camera.top = height / 2;
      camera.bottom = -height / 2;
      camera.updateProjectionMatrix();
      anchors = Array.from(
        sceneRoot?.querySelectorAll<HTMLElement>("[data-particle-shape]") ?? [],
      );
      measureAuth();
    };
    const move = (event: PointerEvent) => {
      pointerPosition.set(
        event.clientX - width / 2,
        height / 2 - event.clientY,
      );
      const target = event.target instanceof Element ? event.target : null;
      const control = target?.closest(
        "a,button,input,select,textarea,pre,[contenteditable],form",
      );
      pointerTarget =
        event.pointerType === "mouse" &&
        (!control || control.hasAttribute("data-field-interaction"))
          ? 1
          : 0;
      if (pointerTarget) {
        const next = {
          x: pointerPosition.x,
          y: pointerPosition.y,
          time: event.timeStamp,
        };
        if (previousPointer && next.time - previousPointer.time < 160) {
          const stroke: PointerStroke = {
            x0: previousPointer.x,
            y0: previousPointer.y,
            x1: next.x,
            y1: next.y,
          };
          stroke.curve = curveCarry(previousStroke, stroke);
          strokes.push(stroke);
          previousStroke = stroke;
          if (strokes.length > 64) strokes.shift();
        } else previousStroke = null;
        previousPointer = next;
      } else {
        previousPointer = null;
        previousStroke = null;
      }
      if (drag && drag.id === event.pointerId) {
        tiltTarget.set(
          Math.max(-0.16, Math.min(0.16, (event.clientX - drag.x) * 0.001)),
          Math.max(-0.12, Math.min(0.12, (event.clientY - drag.y) * 0.001)),
        );
      }
    };
    const leave = () => {
      pointerTarget = 0;
      previousPointer = null;
      previousStroke = null;
      tiltTarget.set(0, 0);
    };
    const down = (event: PointerEvent) => {
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>("[data-field-interaction]")
          : null;
      if (!target || event.pointerType !== "mouse" || event.button !== 0)
        return;
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        element: target,
      };
      target.setPointerCapture(event.pointerId);
    };
    const up = (event: PointerEvent) => {
      if (drag?.id === event.pointerId) {
        if (drag.element.hasPointerCapture(event.pointerId))
          drag.element.releasePointerCapture(event.pointerId);
        drag = null;
        tiltTarget.set(0, 0);
      }
    };
    const key = (event: KeyboardEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.hasAttribute("data-field-interaction") ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      const steps: Record<string, [number, number]> = {
        ArrowLeft: [-0.035, 0],
        ArrowRight: [0.035, 0],
        ArrowUp: [0, -0.035],
        ArrowDown: [0, 0.035],
      };
      const step = steps[event.key];
      if (!step) return;
      event.preventDefault();
      tiltTarget.set(
        Math.max(-0.16, Math.min(0.16, tiltTarget.x + step[0])),
        Math.max(-0.12, Math.min(0.12, tiltTarget.y + step[1])),
      );
    };
    const render = (now: number) => {
      if (disposed || contextLost || document.hidden) return;
      const dt = Math.min((now - last) / 1000 || 0, 0.05);
      last = now;
      elapsed += dt;
      uniforms.clock.value = elapsed;
      uniforms.scrollOffset.value = scrollY;
      const states = anchors.filter(anchor => anchor.isConnected).map((anchor) => {
        const rect = anchor.getBoundingClientRect();
        return {
          shape: (anchor.dataset.particleShape || "code") as Shape,
          at: shapeScrollAnchor(rect.top + scrollY + rect.height / 2, height),
          x: rect.left + rect.width / 2 - width / 2,
          y: height / 2 - rect.top - rect.height / 2,
          size: Math.min(rect.width, rect.height) * 0.42,
          spread: 0,
        };
      });
      const [hero, demo, closing] = states;
      const demoSurface = sceneRoot
        ?.querySelector(".study-demo-surface")
        ?.getBoundingClientRect();
      const heroCopy = sceneRoot
        ?.querySelector(".study-hero-copy")
        ?.getBoundingClientRect();
      if (sceneRoot?.isConnected && (composition === "auth" || composition === "ambient")) {
        // Same glyph identities and inertial interaction, arranged around the
        // centered task. No full-height mask or permanently dispersed edge dust.
        const blend = 1 - Math.exp(-dt * 3);
        uniforms.spread.value += (0 - uniforms.spread.value) * blend;
        uniforms.scale.value += (200 - uniforms.scale.value) * blend;
        uniforms.weights.value.lerp(new THREE.Vector4(1, 0, 0, 0), blend);
        uniforms.center.value.lerp(new THREE.Vector2(authCenter.x,
          composition === "ambient" ? 0 : height / 2 - authCenter.pageY + scrollY), blend);
        uniforms.opacity.value += (0.9 - uniforms.opacity.value) * blend;
      } else if (hero && demo && closing && demoSurface && heroCopy) {
        uniforms.opacity.value += (1 - uniforms.opacity.value) * (1 - Math.exp(-dt * 3));
        // Continuous keyframes, not nearest-anchor selection. Between chapters the
        // same particles remain visible in a quiet edge field around the content.
        // Every sculpture is central. The field retreats to the margins only
        // while content is read, then gathers in the next open central interval.
        const heroClearAt = Math.max(
          hero.at + 1,
          heroCopy.top + scrollY - height * 0.55,
        );
        const clearAt = Math.max(
          demo.at + 1,
          demoSurface.top + scrollY - height * 0.38,
        );
        const keys = [
          hero,
          { ...hero, at: heroClearAt, spread: 1 },
          {
            ...demo,
            at: Math.max(heroClearAt + 1, demo.at - height * 0.75),
            spread: 1,
          },
          { ...demo, at: demo.at - height * 0.12 },
          demo,
          { ...demo, at: Math.min(clearAt - 1, demo.at + height * 0.27) },
          { ...demo, at: clearAt, spread: 1 },
          {
            ...closing,
            at: Math.max(clearAt + 1, closing.at - height * 0.75),
            spread: 1,
          },
          closing,
        ];
        keys.sort((a, b) => a.at - b.at);
        let a = keys[0]!,
          b = a;
        for (let i = 1; i < keys.length; i++) {
          b = keys[i]!;
          if (scrollY <= b.at) break;
          a = b;
        }
        const p =
          a === b
            ? 0
            : smoothProgress((scrollY - a.at) / Math.max(1, b.at - a.at));
        const blend = 1 - Math.exp(-dt * 3);
        const weight = (shape: Shape) =>
          (a.shape === shape ? 1 - p : 0) + (b.shape === shape ? p : 0);
        const desired = new THREE.Vector4(
          weight("code"),
          weight("read"),
          weight("ask"),
          weight("check"),
        );
        uniforms.weights.value.lerp(desired, blend);
        const spread = a.spread + (b.spread - a.spread) * p;
        uniforms.spread.value +=
          (Math.max(spread, 1 - smoothProgress(elapsed / 1.5)) -
            uniforms.spread.value) *
          blend;
        uniforms.opacity.value =
          (1 - uniforms.spread.value) * 0.94 +
          uniforms.spread.value * (light ? 0.5 : 0.6);
        uniforms.center.value.lerp(
          new THREE.Vector2(a.x + (b.x - a.x) * p, a.y + (b.y - a.y) * p),
          blend,
        );
        uniforms.scale.value +=
          (a.size + (b.size - a.size) * p - uniforms.scale.value) * blend;
      }
      if (sceneRoot?.isConnected) {
        uniforms.authMix.value += ((composition === "auth" || composition === "ambient" ? 1 : 0) - uniforms.authMix.value) * (1 - Math.exp(-dt * 3));
      }
      if (authBounds && (composition === "auth" || composition === "ambient")) {
        authContour(count, width, authBounds, elapsed, authScratch);
        for (let i = 0; i < count * 3; i++) authTarget[i] = authScratch[i]! / 200;
      }
      for (let i = 0; i < count * 3; i++) {
        authPoints[i] += (authTarget[i]! - authPoints[i]!) * (1 - Math.exp(-dt * 3));
      }
      geometry.getAttribute("authShape").needsUpdate = true;
      uniforms.pointerActive.value +=
        (pointerTarget - uniforms.pointerActive.value) * Math.min(1, dt * 8);
      uniforms.pointer.value.lerp(pointerPosition, 1 - Math.exp(-dt * 6));
      uniforms.tilt.value.lerp(tiltTarget, 1 - Math.exp(-dt * 2.2));
      uniforms.atmosphereShift.value.lerp(
        new THREE.Vector2(
          (pointerPosition.x / width) * 14 * pointerTarget,
          (pointerPosition.y / height) * 14 * pointerTarget,
        ),
        1 - Math.exp(-dt * 1.4),
      );
      // Stateful, damped return: moving the cursor away does not reset a glyph
      // to its home position on the next frame. The same spring handles release.
      const weights = uniforms.weights.value;
      const scale = uniforms.scale.value,
        spread = uniforms.spread.value;
      const yaw = Math.sin(elapsed * 0.16) * 0.035 + uniforms.tilt.value.x;
      const pitch = uniforms.tilt.value.y;
      for (let i = 0; i < activeTotal; i++) {
        const j = i * 3,
          seed = particleSeed(i);
        let x =
          shapes.code[j]! * weights.x +
          shapes.read[j]! * weights.y +
          shapes.ask[j]! * weights.z +
          shapes.check[j]! * weights.w;
        let y =
          shapes.code[j + 1]! * weights.x +
          shapes.read[j + 1]! * weights.y +
          shapes.ask[j + 1]! * weights.z +
          shapes.check[j + 1]! * weights.w;
        let z =
          shapes.code[j + 2]! * weights.x +
          shapes.read[j + 2]! * weights.y +
          shapes.ask[j + 2]! * weights.z +
          shapes.check[j + 2]! * weights.w;
        const authBlend = uniforms.authMix.value;
        x += (authPoints[j]! - x) * authBlend;
        y += (authPoints[j + 1]! - y) * authBlend;
        z += (authPoints[j + 2]! - z) * authBlend;
        const rotatedZ = -x * Math.sin(yaw) + z * Math.cos(yaw);
        x = x * Math.cos(yaw) + z * Math.sin(yaw);
        y = y * Math.cos(pitch) - rotatedZ * Math.sin(pitch);
        x =
          (x * scale + uniforms.center.value.x) * (1 - spread) +
          (scattered[j]! * width * 0.5 +
            Math.sin(elapsed * 0.13 + seed * 23) * 8 +
            uniforms.atmosphereShift.value.x * (0.3 + seed * 0.7)) *
            spread;
        y =
          (y * scale + uniforms.center.value.y) * (1 - spread) +
          (scattered[j + 1]! * height * 0.5 +
            Math.cos(elapsed * 0.1 + seed * 19) * 6 +
            uniforms.atmosphereShift.value.y * (0.3 + seed * 0.7)) *
            spread;
        if (i >= count) {
          x =
            scattered[j]! * width * 0.5 +
            Math.sin(elapsed * 0.16 + seed * 20) * 10 +
            uniforms.atmosphereShift.value.x * (0.4 + seed * 0.6);
          const raw =
            scattered[j + 1]! * height * 0.5 +
            scrollY * (0.025 + seed * 0.035) +
            Math.cos(elapsed * 0.12 + seed * 15) * 7 +
            uniforms.atmosphereShift.value.y * (0.4 + seed * 0.6) +
            height * 0.6;
          y =
            (((raw % (height * 1.2)) + height * 1.2) % (height * 1.2)) -
            height * 0.6;
        }
        advanceGlyphMotion(
          offsets,
          velocities,
          i,
          x,
          y,
          strokes,
          dt,
          i >= count,
        );
      }
      strokes.length = 0;
      displacement.needsUpdate = true;
      renderer.render(scene, camera);
      if (!ready) {
        ready = true;
        onStatus("ready");
      }
      frame = requestAnimationFrame(render);
    };
    const visibility = () => {
      cancelAnimationFrame(frame);
      last = performance.now();
      if (!document.hidden && !contextLost && !disposed)
        frame = requestAnimationFrame(render);
    };
    const lost = (event: Event) => {
      event.preventDefault();
      cancelAnimationFrame(frame);
      contextLost = true;
      ready = false;
      onStatus("unavailable");
    };
    const restored = () => {
      if (disposed) return;
      contextLost = false;
      onStatus("loading");
      resize();
      visibility();
    };
    const authObserver = new ResizeObserver(measureAuth);
    const selectScene = (next: ParticleScene | null | undefined) => {
      authObserver.disconnect();
      sceneRoot = next === undefined ? root : next?.root ?? null;
      composition = next?.composition ?? initialComposition;
      authContent = composition === "auth" || composition === "ambient"
        ? sceneRoot?.querySelector<HTMLElement>(".public-content, main") ?? sceneRoot : null;
      authBounds = null;
      if (authContent && sceneRoot) {
        authObserver.observe(authContent);
        authObserver.observe(sceneRoot);
      }
      resize();
    };
    changeScene.current = selectScene;
    selectScene(descriptor.current);
    void document.fonts.ready.then(() => { if (!disposed) resize(); });
    frame = requestAnimationFrame(render);
    window.addEventListener("resize", resize);
    root.addEventListener("pointermove", move, { passive: true });
    root.addEventListener("pointerleave", leave);
    root.addEventListener("pointerdown", down);
    root.addEventListener("pointerup", up);
    root.addEventListener("pointercancel", up);
    root.addEventListener("keydown", key);
    root.addEventListener("focusout", leave);
    document.addEventListener("visibilitychange", visibility);
    renderer.domElement.addEventListener("webglcontextlost", lost);
    renderer.domElement.addEventListener("webglcontextrestored", restored);
    return () => {
      disposed = true;
      changeScene.current = null;
      authObserver?.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerleave", leave);
      root.removeEventListener("pointerdown", down);
      root.removeEventListener("pointerup", up);
      root.removeEventListener("pointercancel", up);
      root.removeEventListener("keydown", key);
      root.removeEventListener("focusout", leave);
      document.removeEventListener("visibilitychange", visibility);
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      renderer.domElement.removeEventListener("webglcontextrestored", restored);
      geometry.dispose();
      material.dispose();
      atlas.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [root, light, count, onStatus, initialComposition]);
  return <div ref={host} className="motion-study-canvas" aria-hidden="true" />;
}
