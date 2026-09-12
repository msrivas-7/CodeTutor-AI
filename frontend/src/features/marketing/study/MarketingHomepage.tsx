import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { Wordmark } from "../../../components/Wordmark";
import { FIRST_LESSON_CONTRACT } from "../../../productContract";
import { pickHeroCopy } from "../heroCopy";
import { useMarketingAuth } from "../useMarketingAuth";
import { usePublicMotionScene } from "../public/PublicMotionWorld";
import {
  createShape,
  particleIdentity,
  particleSeed,
  type Shape,
} from "./geometry";
import "./study.css";

const stages = [
  {
    name: "Read",
    shape: "read",
    title: "Start with something you can reason about.",
    description:
      "Read a short lesson. Try a prediction. Then run real code and see where your understanding meets the result.",
    heading: "Find the average score",
    prompt:
      "These scores are 6, 8, and 10. What average would you expect? Read the loop before you run it.",
    output: "3.3333333333333335",
    note: "The result is surprising. That is a useful place to start.",
  },
  {
    name: "Ask",
    shape: "ask",
    title: "A useful question changes what you notice.",
    description:
      "Your tutor helps you inspect your own work. A specific hint gives you a next step without taking the thinking away.",
    heading: "Look at what changes",
    prompt:
      "Trace total after each pass through the loop. Does total = score add to the previous total, or replace it? What would you need to keep?",
    output: "After each pass: 6 → 8 → 10",
    note: "A concrete trace. A question you can answer. The next step is yours.",
  },
  {
    name: "Check",
    shape: "check",
    title: "Code that works. Understanding that stays.",
    description:
      "Check your work, then explain the idea in your own words. Finishing means more than getting a green result.",
    heading: "Explain your change",
    prompt:
      "Why does adding to total keep all three scores, while assigning score to total does not?",
    output: "8.0",
    note: "The learner changed the accumulation. The tutor did not supply the solution.",
  },
] as const;

function StillArt({ shape }: { shape: Shape }) {
  const points = createShape(shape, 90);
  const glyphs = ["{", "}", "<", ">", "[", "]", ";", "+"];
  return (
    <svg viewBox="0 0 200 200" aria-hidden="true" className="study-still">
      <g
        fill="currentColor"
        fontFamily="monospace"
        textAnchor="middle"
        dominantBaseline="middle"
      >
        {Array.from({ length: 90 }, (_, i) => (
          <text
            key={i}
            x={100 + points[i * 3]! * 82}
            y={100 - points[i * 3 + 1]! * 82}
            fontSize={3 + particleSeed(i) * 4}
            opacity={0.4 + particleSeed(i) * 0.6}
          >
            {glyphs[Math.floor(particleIdentity(i)[0] * 8)]}
          </text>
        ))}
      </g>
    </svg>
  );
}

export default function MarketingHomepage() {
  const headline = useRef<HTMLHeadingElement>(null);
  const artworkControl = useRef<HTMLButtonElement>(null);
  const handOffArtworkFocus = useCallback(() => {
    if (artworkControl.current === document.activeElement) {
      headline.current?.focus();
    }
  }, []);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [staticMode, setStaticMode] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">(
    "loading",
  );
  const handleStatus = useCallback(
    (next: "loading" | "ready" | "unavailable") => {
      // Move focus while the control still exists, never after DOM removal.
      if (next !== "ready") handOffArtworkFocus();
      setStatus(next);
    },
    [handOffArtworkFocus],
  );
  const world = usePublicMotionScene(root, "story");
  useEffect(() => handleStatus(world.status), [world.status, handleStatus]);
  const [stage, setStage] = useState(0);
  const { isLoggedIn } = useMarketingAuth();
  const copy = pickHeroCopy();
  const current = stages[stage]!;
  const animate = !staticMode;
  const destination = isLoggedIn ? "/start" : FIRST_LESSON_CONTRACT.route;
  const cta = isLoggedIn ? "Continue learning" : "Try your first lesson";
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      if (query.matches) handOffArtworkFocus();
      setStaticMode(query.matches);
    };
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [handOffArtworkFocus]);
  return (
    <main
      ref={setRoot}
      className={`public-surface motion-study ${animate && status === "ready" ? "study-ready" : ""}`}
      data-marketing="glyph-homepage"
    >
      <a className="study-skip" href="#study-demo">
        Skip to the product walkthrough
      </a>
      <header className="brand-header study-nav">
        <Link to="/" aria-label="CodeTutor AI home">
          <Wordmark size="md" />
        </Link>
        <nav aria-label="Main navigation">
          <Link className="brand-header-action" to={isLoggedIn ? "/start" : "/login"}>
            {isLoggedIn ? "Dashboard" : "Sign in"}{" "}
            <span aria-hidden="true">↗</span>
          </Link>
        </nav>
      </header>
      {animate && status === "unavailable" && (
        <p className="study-motion-notice" role="status">
          {world.loadFailed
            ? "Motion could not load. The walkthrough is still available."
            : "Motion is unavailable. You can still explore the walkthrough."}{" "}
          <button
            type="button"
            onClick={() => {
              if (world.loadFailed) { location.reload(); return; }
              headline.current?.focus();
              setStatus("loading");
              world.retry();
            }}
          >
            {world.loadFailed ? "Reload page" : "Retry motion"}
          </button>
        </p>
      )}

      <section className="study-hero study-wrap" aria-labelledby="study-title">
        <div className="study-hero-art" data-particle-shape="code">
          <StillArt shape="code" />
          {animate && status === "ready" && (
            <button
              ref={artworkControl}
              type="button"
              className="study-art-input"
              data-field-interaction
              aria-label="Gently rotate the code glyphs with arrow keys or drag"
            />
          )}
          <p className="study-art-caption">
            <span className="study-art-rest">
              A little curiosity changes everything.
            </span>
            <span className="study-art-hint">
              Arrow keys to gently tilt · Tab to continue
            </span>
          </p>
        </div>
        <div className="study-hero-copy study-solid">
          <p className="study-eyebrow">A coding tutor. Not a shortcut.</p>
          <h1
            ref={headline}
            tabIndex={-1}
            id="study-title"
            className="font-display"
          >
            {copy.claim}
          </h1>
          <p className="study-lead">
            {copy.subhead}. Read, experiment, and ask better questions. Build an
            understanding that belongs to you.
          </p>
          <Link className="study-cta" to={destination}>
            {cta} <span aria-hidden="true">↗</span>
          </Link>
          <a className="study-text-link" href="#study-demo">
            See how learning happens <span aria-hidden="true">↓</span>
          </a>
        </div>
      </section>

      <section
        id="study-demo"
        className="study-walkthrough study-wrap"
        aria-labelledby="study-demo-title"
      >
        <div className="study-chapter-top">
          <div className="study-solid brand-display-copy">
            <p className="study-eyebrow">01 — The learning loop</p>
            <h2 id="study-demo-title" className="font-display">
              From “why?”
              <br />
              to “I see it.”
            </h2>
          </div>
          <div
            className="study-chapter-art"
            data-particle-shape={current.shape}
          >
            <StillArt shape={current.shape} />
          </div>
        </div>
        <div className="study-demo-surface">
          <div
            className="study-demo-nav"
            role="group"
            aria-label="Walkthrough stages"
          >
            {stages.map((item, i) => (
              <button
                key={item.name}
                type="button"
                aria-pressed={stage === i}
                onClick={() => setStage(i)}
              >
                <span className="study-step">0{i + 1}</span>
                {item.name}
              </button>
            ))}
            <span className="study-demo-caption">
              Illustrative walkthrough · not live AI
            </span>
          </div>
          <div className="study-demo-body">
            <div className="study-code">
              <div className="study-panel-label">
                <span>average.py</span>
                <span>Python</span>
              </div>
              <pre
                tabIndex={0}
                aria-label={`Code example, ${current.name} stage`}
              >
                <code>
                  <span className="study-comment">
                    # Find the average of three scores
                  </span>
                  {"\n"}scores = [<span className="study-number">6, 8, 10</span>
                  ]{"\n"}total = <span className="study-number">0</span>
                  {"\n\n"}
                  <span className="study-keyword">for</span> score{" "}
                  <span className="study-keyword">in</span> scores:{"\n"}
                  <span className="study-code-highlight">
                    {"    "}
                    total {stage === 2 ? "+=" : "="} score
                  </span>
                  {"\n\n"}average = total /{" "}
                  <span className="study-function">len</span>(scores){"\n"}
                  <span className="study-function">print</span>(average)
                </code>
              </pre>
              <div
                className={`study-output ${stage === 2 ? "study-output-success" : ""}`}
              >
                <span className="study-panel-label">
                  {stage === 1 ? "Trace the loop" : "Example output"}
                </span>
                <samp>{current.output}</samp>
              </div>
            </div>
            <div className="study-conversation">
              <p className="study-panel-label">
                {stage === 0 ? "Your lesson" : "Your tutor"}
              </p>
              <h3>{current.heading}</h3>
              {stage === 1 && (
                <p className="study-learner">
                  “I expected 8. Why am I getting 3.33?”
                </p>
              )}
              <p className="study-tutor-message">{current.prompt}</p>
              {stage === 2 && (
                <p className="study-learner">
                  “Assignment kept only the last score. Adding each score keeps
                  the running total: 24 divided by 3 is 8.”
                </p>
              )}
              <p className="study-demo-note">{current.note}</p>
            </div>
          </div>
          <div className="study-demo-explanation" aria-live="polite">
            <h3>{current.title}</h3>
            <p>{current.description}</p>
          </div>
        </div>
      </section>

      <section
        className="study-closing study-wrap"
        aria-labelledby="study-closing-title"
      >
        <div className="study-closing-art" data-particle-shape="check">
          <StillArt shape="check" />
        </div>
        <div className="study-solid">
          <p className="study-eyebrow">02 — Your next line</p>
          <h2 id="study-closing-title" className="font-display">
            Less copying.
            <br />
            More understanding.
          </h2>
          <p className="study-lead">
            A lesson, an editor, and a tutor to help you think it through. Start
            with one small program.
          </p>
          <Link className="study-cta" to={destination}>
            {cta} <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </section>
      <footer className="study-footer study-wrap study-solid">
        <Wordmark size="sm" />
        <nav aria-label="Footer">
          <Link to="/why-not-chatgpt">Why not ChatGPT?</Link>
          <a href="/learn-to-code/">Lessons</a>
          <Link to="/login">Sign in</Link>
          {!isLoggedIn && <Link to="/signup">Create an account</Link>}
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/support">Support</Link>
          <a
            href="https://github.com/msrivas-7/CodeTutor-AI"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
          <a
            href="https://www.linkedin.com/in/msrivas7/"
            target="_blank"
            rel="noreferrer"
          >
            LinkedIn
          </a>
        </nav>
      </footer>
    </main>
  );
}
