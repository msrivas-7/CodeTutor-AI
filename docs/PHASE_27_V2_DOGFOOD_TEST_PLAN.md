# Phase 27-v2 Dogfood Test Plan — Automated QA Runbook

**Branch under test**: `phase-27-first-60s` (25 commits ahead of `main`)
**Backend**: Supabase dev project (`codetutor-dev`, ref `jizysywayotcmapgnbrc`). Migrations applied 2026-05-05.
**Frontend / backend run locally on host** via `docker compose up`.

---

## 1. Setup

### 1.1 Local server URLs

| Surface | URL |
|---|---|
| Frontend (Vite dev) | `http://localhost:5173` |
| Backend API | `http://localhost:4000` |
| Marketing landing | `http://localhost:5173/` |
| Anon trial path | `http://localhost:5173/try/lesson/python-fundamentals/hello-world` |
| Login | `http://localhost:5173/login` |
| Signup | `http://localhost:5173/signup` |
| Authed home | `http://localhost:5173/start` |
| Authed lesson 1 | `http://localhost:5173/learn/course/python-fundamentals/lesson/hello-world` |
| Authed lesson 2 | `http://localhost:5173/learn/course/python-fundamentals/lesson/variables` |

### 1.2 Bring up the stack

```bash
cd /Users/mehul/Projects/AICodeEditor
git checkout phase-27-first-60s
docker compose up -d --build
# Verify both services healthy:
curl -f http://localhost:4000/healthz
curl -f http://localhost:5173/
```

If `frontend` or `backend` containers fail, rebuild without cache:

```bash
docker compose down
docker compose build --no-cache backend frontend
docker compose up -d
```

### 1.3 Test user credentials (already created on dev Supabase)

| Field | Value |
|---|---|
| Email | `phase27v2-tester@codetutor.test` |
| Password | `Phase27V2-Test-Pass-123!` |
| User ID | `de3d6f0b-383f-4bdf-8b96-568abd9c0b82` |
| First name (in user_metadata) | `Tester` |
| Email confirmed | yes (created via admin API) |

This user is for tests that require a logged-in session. **Do NOT use it for fresh-signup tests** — those need a brand-new email each run.

For fresh-signup tests, generate a unique email:

```javascript
const fresh = `dogfood-${Date.now()}-${Math.floor(Math.random()*1e6)}@codetutor.test`;
const password = "Dogfood-Test-Pass-123!";
const firstName = "Maya"; // or Alex, depending on persona under test
```

### 1.4 Reset state between tests

Most tests need `sessionStorage` cleared and the test user's server-state reset. Two helpers:

**Browser-side (Playwright `addInitScript` or `page.evaluate`):**

```javascript
// Before navigating to /try or /start, clear all anon-flow flags:
window.sessionStorage.removeItem("codetutor.anonCinematicSeen");
window.sessionStorage.removeItem("codetutor.anonCoachSeen");
window.sessionStorage.removeItem("codetutor.anonRun");
window.localStorage.clear();
```

**Server-side (delete the test user's progress + reset preferences) — only needed for the logged-in tests:**

```bash
# Delete lesson_progress + course_progress for the test user, reset preferences
# to defaults. The test user itself stays — only its data is wiped.
USER_ID="de3d6f0b-383f-4bdf-8b96-568abd9c0b82"
DATABASE_URL="postgresql://postgres.jizysywayotcmapgnbrc:curfer-nyrse4-ryhfyZ@aws-1-us-east-2.pooler.supabase.com:5432/postgres"

psql "$DATABASE_URL" <<SQL
DELETE FROM lesson_progress WHERE user_id = '${USER_ID}';
DELETE FROM course_progress WHERE user_id = '${USER_ID}';
UPDATE user_preferences
   SET welcome_done = FALSE,
       workspace_coach_done = FALSE,
       editor_coach_done = FALSE,
       disable_streaks = FALSE
 WHERE user_id = '${USER_ID}';
SQL
```

---

## 2. Test scenarios

Each scenario has **Setup**, **Steps**, **Expected**, and **Failure modes**. Run in the order listed; later tests assume earlier ones passed.

---

### 2.1 Anon path — first impression (cold tab)

**Test ID**: `ANON-001`
**Persona**: Maya
**Goal**: Maya lands on /try/ from a TikTok link. Cinematic plays in full.

**Setup**:
- Fresh browser context (no cookies, no sessionStorage, no localStorage).
- Reduced-motion OFF in OS settings (default).

**Steps**:
1. Navigate to `http://localhost:5173/try/lesson/python-fundamentals/hello-world`.
2. Observe the page for 16 seconds without interaction.
3. Take screenshots at: t=1s, t=4s, t=8s, t=12s, t=16s.

**Expected**:
- t=1s: dark fullscreen overlay; subtle radial glow rising; nothing else visible yet.
- t=4s: REPL prompt visible — text reads `>>> print("Hello, " + name + "!")`. Type writing animation in progress (cursor blinking).
- t=8s: Code line settled; about to flash into hero text.
- t=12s: Output preview line `Hello, ____!` visible (monospace) with the substring `____` (four underscores) opacity-pulsing + dashed-underlined at accent color (a "fillable slot"). Hero text "Your turn." visible left-aligned BELOW the output preview, large display font (Phase 27-v2.2 Fix 2: was `Hello, YOUR_NAME!` in v2.1 — the literal token pre-resolved the in-lesson auto-Run reveal; blanks read as fillable without telegraphing).
- t=16s: Cinematic dismissed. WorkspaceCoach 6-step tour mounted (first bubble: "Lesson Instructions").
- "Skip" button bottom-right of cinematic visible from t≥4s onward.

**Failure modes**:
- Cinematic shows JavaScript code (`reverse() === ...` style) → STALE — Day 2 fix didn't land. CODE_LINE in `frontend/src/features/firstRun/CinematicGreeting.tsx:125` should be `'>>> print("Hello, " + name + "!")'`.
- Hero says "Hello, there!" or "Hi, there!" or "Hello, world." → STALE — v2.1 anon redesign didn't land. Anon hero MUST read "Your turn." with the `Hello, ____!` output preview rendered above it (Phase 27-v2.2 Fix 2 — was `Hello, YOUR_NAME!`; if you see the literal YOUR_NAME token in the cinematic, the placeholder change didn't land).
- Cinematic restarts mid-arc (visible pop / glitch in the typewriter beat) → Day 2 round-2 P0 regression — `cinematicNode` not at same tree position across all branches.
- "Loading lesson…" muted text visible briefly before cinematic mounts → also Day 2 round-2 regression.

**Cleanup**: keep state for `ANON-002`.

---

### 2.2 Anon path — cinematic Skip via Esc

**Test ID**: `ANON-002`
**Persona**: Maya
**Goal**: Esc dismisses cinematic; reload doesn't replay.

**Setup**: Fresh context. Navigate to `http://localhost:5173/try/lesson/python-fundamentals/hello-world`.

**Steps**:
1. Wait 4s for cinematic to mount + Skip button to fade in.
2. Press `Escape`.
3. Wait 1s.
4. Reload the page (F5 / `page.reload()`).
5. Observe for 5s.

**Expected**:
- After Escape: cinematic exits within ~300ms. WorkspaceCoach 6-step tour mounts (first bubble visible: "Lesson Instructions").
- After reload: cinematic does **NOT** replay. Workspace body + WorkspaceCoach tour should mount immediately (or coach should already be dismissed if previously seen — but on a Skip-mid-cinematic the coach hasn't been completed yet, so it mounts on reload).

**Failure modes**:
- Cinematic replays after reload → sessionStorage flag `codetutor.anonCinematicSeen=1` not stamped. Bug in `dismissCinematic` at AnonLessonPage.tsx.

**Cleanup**: clear sessionStorage; close context.

---

### 2.3 Anon path — cinematic auto-completes

**Test ID**: `ANON-003`
**Persona**: Maya
**Goal**: Cinematic dissolves naturally without user interaction.

**Setup**: Fresh context.

**Steps**:
1. Navigate to `/try/lesson/python-fundamentals/hello-world`.
2. Wait 18 seconds without any input.
3. Take screenshot.

**Expected**:
- After ~14.5s: cinematic gone. WorkspaceCoach tour visible. Page fully rendered (anon badge "Try it — no signup" in header, Run button, code editor).
- "Skip" button no longer present (cinematic unmounted).

**Failure modes**:
- After 18s the cinematic is still visible → onComplete timer broken.
- Page chrome visible behind a still-running cinematic overlay → z-index regression.

---

### 2.4 Anon path — WorkspaceCoach 6-step tour

**Test ID**: `ANON-004`
**Persona**: Maya
**Goal**: Coach walks through all 6 spotlight targets.

**Setup**: Fresh context. Pre-set sessionStorage to skip cinematic:

```javascript
await page.addInitScript(() => {
  window.sessionStorage.setItem("codetutor.anonCinematicSeen", "1");
});
```

**Steps**:
1. Navigate to `/try/lesson/python-fundamentals/hello-world`.
2. Wait for first coach bubble to appear (max 10s).
3. Verify bubble title: **"Lesson Instructions"**. Click "Got it".
4. Verify next bubble title: **"Code Editor"**. Click "Got it".
5. Verify next bubble title: **"Run Your Code"**. Click "Got it".
6. Verify next bubble title: **"Output Panel"**. Click "Got it".
7. Verify next bubble title: **"Check My Work"**. Click "Got it".
8. Verify next bubble title: **"AI Tutor"**. Click "Got it".
9. After step 6 dismisses, observe page for 3s.

**Expected**:
- All 6 bubbles render in order. Each spotlight cuts a circle around the named element.
- After step 6: scripted Socratic walkthrough begins. Tutor bubble at bottom shows "Hey there — good to meet you. That little program on your screen? Let me run it for you. — watch the bottom" (typewriter cadence ~50ms/char).
- Auto-Run fires ~1s after the greet finishes.

**Failure modes**:
- Bubble #1 ("Lesson Instructions") missing on mobile viewport → instrAnchorRef on `display:none` element. Day 7 fix should have hoisted it to the parent `<section>`.
- Step cascades through all 6 silently without showing bubbles → coach mounts before refs are committed (`coachReady` useEffect gate not working).
- Less than 6 steps fire → some target ref is null because the JSX node isn't rendered.

---

### 2.5 Anon path — WorkspaceCoach Esc dismisses

**Test ID**: `ANON-005`
**Persona**: Maya
**Goal**: Esc on coach skips the rest of the tour.

**Setup**: Same as `ANON-004`.

**Steps**:
1. Navigate to `/try/lesson/python-fundamentals/hello-world`.
2. Wait for first coach bubble.
3. Press `Escape`.
4. Wait 1s.
5. Reload the page.

**Expected**:
- After Escape: coach unmounts. Scripted walkthrough begins (greet bubble in tutor pane).
- After reload: coach does NOT replay. sessionStorage `codetutor.anonCoachSeen` should be `1`.

---

### 2.6 Anon path — full scripted walkthrough (success)

**Test ID**: `ANON-006`
**Persona**: Maya
**Goal**: Maya replaces YOUR_NAME, runs, sees personalized praise.

**Setup**: Fresh context. Pre-set both flags:

```javascript
await page.addInitScript(() => {
  window.sessionStorage.setItem("codetutor.anonCinematicSeen", "1");
  window.sessionStorage.setItem("codetutor.anonCoachSeen", "1");
});
```

**Steps**:
1. Navigate to `/try/lesson/python-fundamentals/hello-world`.
2. Wait for the scripted greet bubble in the tutor pane (max 10s). Text contains "Hey there — good to meet you".
3. Wait for auto-Run to fire (max 5s after greet completes). Output panel should show `Hello, YOUR_NAME!`.
4. Wait for celebrateRun bubble in tutor pane (max 12s). Text contains "Hello, YOUR_NAME! just printed" + "replace YOUR_NAME with your actual name".
5. Click into the Monaco editor. Replace `YOUR_NAME` with `Maya` (the literal string `"YOUR_NAME"` becomes `"Maya"`).
6. Click the **Run** button (▶ Run, top-right of editor).
7. Wait for output to update. Should show `Hello, Maya!`.
8. Wait for the praise turn in the tutor pane (max 12s). Text should contain "Perfect, Maya — your computer just said hi to you, by name."
9. Wait for the praise typewriter to finish (max 15s).

**Expected**:
- Each scripted bubble types in character-by-character at ~50ms/char.
- Praise turn personalizes with the literal name "Maya" extracted from the code.
- Tutor input field shows placeholder "Tutor's mid-thought — give them a sec…" and is disabled during scripted phase.
- After praise completes, the **"Check my work ✓"** button at the bottom of the editor pane becomes enabled (was disabled before validation passed).

**Failure modes**:
- Praise turn says "Perfect, there —" not "Perfect, Maya —" → `extractNameFromCode` returned null. Verify code change actually replaced YOUR_NAME with quoted "Maya".
- Tutor input still says "What's confusing you?" during scripted phase → `scriptedActive` gate not working.
- Check button stays disabled even after personalized run → `validation.passed` not flipping; check that lesson.json has BOTH rules (`expected_stdout: "Hello, "` AND `forbidden_in_stdout: "YOUR_NAME"`).

---

### 2.7 Anon path — validator rejects unedited starter

**Test ID**: `ANON-007`
**Persona**: Maya
**Goal**: The dual-rule validator must NOT pass the unedited `name = "YOUR_NAME"` code.

**Setup**: Same pre-set flags as `ANON-006`.

**Steps**:
1. Navigate to `/try/lesson/python-fundamentals/hello-world`.
2. Wait for choreography to reach the celebrateRun stage (or skip past via the user typing — actually wait through to praise turn).
3. **Without editing the code**, just click **Run** (the auto-Run already produced `Hello, YOUR_NAME!`). Output should still show `Hello, YOUR_NAME!`.
4. Try to click "Check my work ✓".

**Expected**:
- The Check button should be DISABLED while `output.stdout` still contains `YOUR_NAME`.
- Hovering / focusing it should show no completion celebration.

**Failure modes**:
- Check button is enabled despite `Hello, YOUR_NAME!` output → validator regression. Check `lesson.json:20-29` has both rules; check `validator.ts:91-119` implements `forbidden_in_stdout`.
- Clicking Check fires the celebration block "You did it, YOUR_NAME." → catastrophic — trust break.

---

### 2.8 Anon path — wrong-edit correction (placeholder still present)

**Test ID**: `ANON-008`
**Persona**: Maya
**Goal**: Tutor surfaces a correction-keyed turn when output still contains YOUR_NAME after edit.

**Setup**: Same as `ANON-006`.

**Steps**:
1. Navigate to `/try/lesson/python-fundamentals/hello-world`.
2. Wait through to celebrateRun.
3. In the editor, change `name = "YOUR_NAME"` to `name = "Hi YOUR_NAME"` (intentionally leaves placeholder in).
4. Click Run.
5. Wait 12s.

**Expected**:
- Output: `Hello, Hi YOUR_NAME!`
- Tutor types the WRONG_EDIT_PLACEHOLDER scripted turn: "Almost — you still have `YOUR_NAME` in there. Replace it with your actual name (keep the quotes around it), then run again."
- Check button stays disabled.

---

### 2.9 Anon path — wrong-edit correction (empty output)

**Test ID**: `ANON-009`
**Persona**: Maya
**Goal**: Tutor surfaces empty-output correction.

**Steps**:
1. Same setup as above. After celebrateRun, edit code to delete the print statement entirely:
   ```python
   name = "Maya"
   ```
   (No print.)
2. Click Run.
3. Wait 12s.

**Expected**:
- Output is empty.
- Tutor types: "Hmm — nothing printed. Make sure you still have a `print(...)` call in the file. Tweak and run again."

---

### 2.10 Anon path — wrong-edit correction (syntax error)

**Test ID**: `ANON-010`
**Persona**: Maya

**Steps**:
1. Same setup. After celebrateRun, edit code to:
   ```python
   name = Maya  # missing quotes — NameError
   print("Hello, " + name + "!")
   ```
2. Click Run.
3. Wait 12s.

**Expected**:
- Output panel shows red error text (NameError or similar).
- Tutor types: "Something errored out — have a look at the red text in the output panel. Most common cause here: missing quotes around your name. It needs to be in quotes, like `\"Maya\"`."

---

### 2.11 Anon path — second-attempt rescue (STRONGER_HINT)

**Test ID**: `ANON-011`
**Persona**: Maya

**Steps**:
1. Same setup. After celebrateRun, intentionally fail TWICE:
   - First wrong run: delete print statement (test 2.9 path).
   - Wait for correction turn.
   - Second wrong run: still no print, just `name = "X"`.
2. Wait 12s.

**Expected**:
- After the SECOND wrong run, the tutor types the STRONGER_HINT copy (which gives the answer directly per scriptedTurns.ts).

**Failure modes**:
- Same WRONG_EDIT_GENERIC turn fires twice → `wrongEditAttempts` counter not bumping.

---

### 2.12 Anon path — Check button passes on personalized output

**Test ID**: `ANON-012`
**Persona**: Maya
**Goal**: Personalized output enables Check; clicking shows celebration.

**Setup**: Continue from `ANON-006` state (post-praise turn).

**Steps**:
1. After praise lands, click **"Check my work ✓"**.
2. Observe the editor pane.

**Expected**:
- Bottom CTA row collapses (Save + Check buttons gone).
- Inline celebration block appears beneath the editor:
  - Heading: `Lesson 1 complete` (small uppercase)
  - Title: `You did it, Maya.` (display font, large)
  - Subtitle: `Lesson 2 picks up right where you are. Sign up to keep going — your code and name come with you.`
  - CTA button: `Sign up to keep going →` (gradient accent → violet)
- The Sign Up button is the ONLY interactive element in the celebration block.

**Failure modes**:
- Heading says "You did it, there." or "You wrote your first program." → `extractNameFromCode(code)` returned null. Possible: name has special chars, or stash schema regression.
- Save / Next-lesson buttons still visible → `lessonComplete` state didn't flip.
- Wall opens immediately on Check (no celebration block) → `setLessonComplete(true)` skipped.

---

### 2.13 Anon path — celebration → Sign Up CTA opens wall

**Test ID**: `ANON-013`
**Persona**: Maya

**Steps**:
1. From the celebration state (ANON-012), click "Sign up to keep going →".

**Expected**:
- `SignupWallDialog` appears with role=`alertdialog`.
- Dialog title: **"Keep going?"**
- Dialog body: **"Lesson 2 picks up right where you are. Your code, your name, and the lesson you just finished come with you when you sign up."**
- Buttons: "Not yet" (left) and "Start lesson 2 →" (right, gradient).
- The "Start lesson 2 →" button is a `<a href="/signup">` link.

**Failure modes**:
- Body says "Lesson 2 starts where this one left off" (old copy) → Day 5 copy fix didn't land.
- Dialog never opens → CTA click handler broken.

**State check**: At this moment, `sessionStorage.getItem("codetutor.anonRun")` MUST be a non-null JSON string. Verify:

```javascript
const stash = JSON.parse(window.sessionStorage.getItem("codetutor.anonRun") ?? "null");
expect(stash).toMatchObject({
  v: 1,
  courseId: "python-fundamentals",
  lessonId: "hello-world",
  code: expect.stringContaining('name = "Maya"'),
  name: "Maya",
  flags: { welcomeDone: true, workspaceCoachDone: true },
});
```

---

### 2.14 Anon path — wall "Not yet" preserves stash

**Test ID**: `ANON-014`
**Persona**: Maya

**Steps**:
1. From the wall (ANON-013), click "Not yet".

**Expected**:
- Dialog dismisses.
- Celebration block still visible.
- Stash IS still in sessionStorage (NOT cleared on dismiss — only on successful handoff).

---

### 2.15 Anon path — wall Esc dismisses

**Test ID**: `ANON-015`
**Persona**: Maya

**Steps**:
1. From celebration, click Sign Up to open wall.
2. Press Escape.

**Expected**: Dialog dismisses. Same as "Not yet".

---

### 2.16 Anon path — wall click outside (backdrop) dismisses

**Test ID**: `ANON-016`

**Steps**: Click the dimmed backdrop area (outside the white panel).

**Expected**: Dialog dismisses.

---

### 2.17 Anon path — Save button pre-completion opens wall (save reason)

**Test ID**: `ANON-017`
**Persona**: Maya
**Goal**: Save button BEFORE completing the lesson opens the wall with `reason="save"`.

**Setup**: Same as `ANON-006`. After choreography reaches awaitEdit, do NOT edit the code.

**Steps**:
1. After scripted greet finishes (auto-Run fired), click the **"Save"** button at the bottom of the editor pane.

**Expected**:
- Wall opens with title: **"Sign up to save?"**
- Body: "Takes 10 seconds. From the moment you sign up, your code and progress save automatically — so you never lose a line of work again."
- CTA: "Sign up for free →"
- Note: This path does NOT write the stash (only the celebration's Sign Up CTA writes it). Pre-completion save signups land in the standard /welcome flow.

---

### 2.18 Anon path — top-bar Sign Up to save also opens wall

**Test ID**: `ANON-018`

**Steps**: Click "Sign up to save" in the top-right header.

**Expected**: Same as ANON-017 (wall reason="save").

---

### 2.19 Anon path — non-allowlisted lesson redirects to /

**Test ID**: `ANON-019`

**Steps**: Navigate to `http://localhost:5173/try/lesson/python-fundamentals/variables`.

**Expected**: Page redirects to `http://localhost:5173/` (marketing page) within 5s.

**Failure modes**: If the page renders a lesson page, the allowlist guard at `AnonLessonPage.tsx:131-133` is broken.

---

### 2.20 Anon path — mobile viewport

**Test ID**: `ANON-020`
**Persona**: Maya (on iPhone 13)
**Goal**: Full anon journey works on mobile.

**Setup**:
```javascript
await context.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
```

**Steps**: Repeat ANON-001 through ANON-013 on mobile.

**Expected** (mobile-specific):
- Instructions panel collapsed by default. "Show instructions ↓" button visible. Tapping expands.
- WorkspaceCoach step 1 ("Lesson Instructions") MUST mount and be visible (the spotlight should land on the section, not a `display:none` div).
- Editor stacks vertically below instructions.
- All 6 coach steps visible and dismissable.

**Failure modes**:
- Coach step 1 ("Lesson Instructions") never appears on mobile — Day 7 P1 regression. Verify `instrAnchorRef` is on the parent `<section>`, not the inner div.
- Touch targets too small to tap (header link, Save, Run buttons) — known v1 P1 carryover.

---

### 2.21 Anon path — AI tutor real Q&A (post-scripted)

**Test ID**: `ANON-021`
**Persona**: Maya
**Goal**: After scripted choreography ends, tutor input becomes usable.

**Setup**: Continue from `ANON-006` (after praise + check celebration; OR after step==="done").

**Steps**:
1. Click "Not yet" on the wall to dismiss it.
2. Wait for tutor input placeholder to flip from "Tutor's mid-thought…" to "What's confusing you?".
3. Type: `what does + do here?` and press Ask (or Enter).
4. Wait up to 25s for response.

**Expected**:
- Tutor bubble shows "…" thinking indicator while streaming.
- Eventually the bubble is replaced with a coherent tutor response (summary + maybe hint).
- The bubble text should NOT contain raw JSON tokens like `{"summary":"..."` (Day 3d fix verified).

**Failure modes**:
- Bubble shows `{"summary":"...` for ~2s before final text → Day 3d raw-JSON regression.
- Bubble stays "…" forever → SSE stream broken or `done` event never fires.

---

### 2.22 Anon path — AI quota exhaustion → wall (exhausted reason)

**Test ID**: `ANON-022`
**Persona**: Maya
**Goal**: After 8 anon AI questions per IP per day, 9th triggers `reason="exhausted"`.

**Setup**: Same as ANON-021 but burn through quota first.

**Steps**:
1. Reach the post-scripted state.
2. Send 8 tutor questions in quick succession (use generic prompts: `q1`, `q2`, ... `q8`). Wait for each response.
3. Send the 9th: `q9`.

**Expected** (might require a real backend + valid platform key):
- The 9th request returns 429.
- Wall opens with title: **"You're getting it."**
- Body: "You've used your free tutor questions for today. Make a free account for a higher daily quota — and your work saves from then on."

**Note**: If running without a valid `PLATFORM_OPENAI_API_KEY`, AI requests will fail with 503 / 500 and surface the friendly error in the bubble instead. Mark this test as conditional.

---

### 2.23 Anon path — kill switch (operator)

**Test ID**: `ANON-023`
**Persona**: operator
**Goal**: `ENABLE_ANON_LESSON=0` short-circuits all anon endpoints.

**Setup**:
```bash
# Stop the backend, set the env, restart:
docker compose stop backend
ENABLE_ANON_LESSON=0 docker compose up -d backend
sleep 3
```

**Steps**:
1. Navigate to `/try/lesson/python-fundamentals/hello-world` in a fresh tab.
2. Skip past cinematic + coach.
3. Click Run.

**Expected**:
- `POST /api/anon/run` returns **503** with body `{"error": "ANON_LESSON_DISABLED"}`.
- Output panel shows "Run failed (503)" or similar friendly mapping.

**Cleanup**:
```bash
docker compose stop backend
docker compose up -d backend  # restart without env override
```

---

### 2.24 Signup-from-anon — full handoff flow (the v2 P0 surface)

**Test ID**: `HANDOFF-001`
**Persona**: Maya
**Goal**: After the celebration, signing up routes Maya directly to lesson 2 with state carried.

**Setup**: Fresh context. Generate a unique fresh email:

```javascript
const fresh = `dogfood-handoff-${Date.now()}-${Math.floor(Math.random()*1e6)}@codetutor.test`;
const password = "Dogfood-Test-Pass-123!";
```

**Steps**:
1. Navigate to `/try/lesson/python-fundamentals/hello-world`.
2. Walk through the full anon flow (cinematic → coach → walkthrough → edit YOUR_NAME → Maya → Run → praise) until celebration block appears.
3. Click "Sign up to keep going →".
4. On the wall, click "Start lesson 2 →".
5. On `/signup`: enter firstName "Maya", email (the fresh email above), password, confirm. Click Sign Up.

**Expected** (depending on email-confirmation setting — dev project may have it OFF):

**If email-confirmation OFF (typical local dev)**:
- After signup, page navigates to `/start`.
- A loading shell briefly shows: **"Carrying your work over…"** (centered, muted text).
- Within ~1s, page redirects to `/learn/course/python-fundamentals/lesson/variables` (lesson 2).
- The `/welcome` cinematic does **NOT** play.
- The 6-step WorkspaceCoach does **NOT** auto-open on lesson 2.
- The `?firstRun=1` choreography does **NOT** fire on lesson 2.
- The lesson 2 page shows the lesson 2 starter (NOT lesson 1's hello-world).

**If email-confirmation ON**: a "Check your email" panel appears. To complete the test, click the confirmation link in the email (or use admin API to confirm the user). Then resume — the AuthCallbackPage routes through /start where the same handoff intercept fires.

**State checks**:
- `sessionStorage.getItem("codetutor.anonRun")` should be `null` (cleared on successful handoff).
- DB query against the test user (use the email `fresh`):
  ```sql
  SELECT lp.lesson_id, lp.status, lp.last_code
    FROM lesson_progress lp
    JOIN auth.users u ON u.id = lp.user_id
   WHERE u.email = '<fresh>'
     AND lp.lesson_id = 'hello-world';
  ```
  Should return one row with `status = 'completed'` and `last_code` containing `name = "Maya"`.
- `SELECT welcome_done, workspace_coach_done FROM user_preferences WHERE user_id = <fresh user id>;` should return `(true, true)`.

**Failure modes** (CRITICAL):
- Page lands on `/welcome` and the cinematic plays again → handoff intercept failed; doubled experience regressed.
- Page lands on `/learn/course/python-fundamentals/lesson/hello-world` (NOT variables) → routing broken.
- WorkspaceCoach auto-opens on lesson 2 → workspace_coach_done flag not written.
- Loading shell ("Carrying your work over…") never appears → `handoffPhase` race regression.
- Loading shell appears and never goes away → handoff hung; check round-3 P0 fix at StartPage.tsx (effect must run once on mount, not depend on handoffPhase).

**Cleanup**: delete the fresh user via admin API or just leave it (no cross-test interference).

---

### 2.25 Signup-from-anon — handoff failure path (5xx fallback)

**Test ID**: `HANDOFF-002`
**Persona**: Maya
**Goal**: When the handoff endpoint fails, StartPage falls through to the standard /welcome flow without hanging.

**Setup**: Fresh context. New fresh email. Use Playwright route interception to fail `/api/anon-handoff`:

```javascript
await page.route("**/api/anon-handoff", route => {
  route.fulfill({
    status: 500,
    contentType: "application/json",
    body: JSON.stringify({ error: "INTERNAL_SERVER_ERROR" }),
  });
});
```

**Steps**:
1. Pre-populate stash:
   ```javascript
   await page.addInitScript(() => {
     window.sessionStorage.setItem("codetutor.anonCinematicSeen", "1");
     window.sessionStorage.setItem("codetutor.anonCoachSeen", "1");
     window.sessionStorage.setItem("codetutor.anonRun", JSON.stringify({
       v: 1,
       completedAt: new Date().toISOString(),
       courseId: "python-fundamentals",
       lessonId: "hello-world",
       code: 'name = "Maya"\nprint("Hello, " + name + "!")',
       name: "Maya",
       flags: { welcomeDone: true, workspaceCoachDone: true },
     }));
   });
   ```
2. Sign up via `/signup` with a fresh email.
3. Wait up to 15s.

**Expected**:
- Loading shell may appear briefly.
- Within ~10s, the page exits the loading shell.
- User lands on `/start` card grid (Open Editor / Guided Course cards) OR on `/welcome` (depends on the user's welcomeDone in DB — fresh user has welcomeDone=false → /welcome cinematic).
- Stash is **STILL** in sessionStorage (not cleared on failure — preserved for retry).

**Failure modes**:
- Loading shell never disappears → round-3 P0 regression at StartPage handoff effect.

---

### 2.26 Signup-from-anon — refresh of /start does NOT re-fire handoff

**Test ID**: `HANDOFF-003`

**Steps**:
1. Complete `HANDOFF-001` successfully (land on lesson 2).
2. Navigate manually to `/start`.
3. Verify network tab does NOT see another POST /api/anon-handoff.
4. Page should render the StartPage card grid (welcomeDone=true now).

**Expected**:
- No second handoff POST (stash already cleared).
- Page lands on /start card grid (not /welcome — welcomeDone is true on user_preferences row).

---

### 2.27 Direct signup (Alex path, no anon stash)

**Test ID**: `DIRECT-001`
**Persona**: Alex
**Goal**: Direct signup (no /try/ visit) gets the full /welcome cinematic + lesson 1 firstRun choreography.

**Setup**: Fresh context. Fresh email. Do NOT visit /try/.

**Steps**:
1. Navigate to `/signup`.
2. Enter firstName "Alex", fresh email, password.
3. Submit.
4. Observe redirect.

**Expected**:
- Land on `/start`.
- Synchronously (no loading shell, no handoff POST), redirect to `/welcome`.
- Cinematic plays full 14.2s with hero "Hello, Alex!".
- Cinematic dissolves → page navigates to `/learn/course/python-fundamentals/lesson/hello-world?firstRun=1`.
- WorkspaceCoach 6-step tour fires.
- After coach: scripted Socratic walkthrough fires with "Hey Alex — good to meet you" greet.
- This path is unchanged from v1 (Alex's experience is preserved).

**Failure modes**:
- Loading shell "Carrying your work over…" appears for Alex (no stash) → bug in handoffPhase initial state.
- /welcome doesn't play → welcomeDone gate regression on StartPage.

---

### 2.28 Login flow (returning user)

**Test ID**: `AUTH-001`

**Setup**: Fresh context.

**Steps**:
1. Navigate to `http://localhost:5173/login`.
2. Enter email `phase27v2-tester@codetutor.test`, password `Phase27V2-Test-Pass-123!`.
3. Click Sign In.

**Expected**:
- Landing depends on user's previous state (welcomeDone, lesson_progress). For a fresh test-user state (after step 1.4 reset), welcomeDone=false → /welcome → /learn/.../hello-world?firstRun=1.

---

### 2.29 Disable streaks (Alex toggle)

**Test ID**: `STREAKS-001`
**Persona**: Alex
**Goal**: Toggling Hide Streaks ON removes the streak chip and excludes user from email digest.

**Setup**: Logged in as `phase27v2-tester@codetutor.test`.

**Steps**:
1. Navigate to settings (typically `/settings` or via UserMenu → Settings → Account tab).
2. Find the "Hide streaks" toggle.
3. Toggle ON.
4. Wait 1s.
5. Reload the page.
6. Look at the top-center of the toolbar.

**Expected**:
- Streak chip is NOT visible after toggle ON.
- After reload, streak chip still not visible.

**DB check** (T+24h after a streak-extending action):
```sql
SELECT * FROM user_preferences WHERE user_id = 'de3d6f0b-383f-4bdf-8b96-568abd9c0b82';
```
Should show `disable_streaks = true`.

**Toggle OFF**:
1. Toggle Hide Streaks back to OFF.
2. Streak chip should reappear with the preserved count (data not deleted, just hidden).

---

### 2.30 Settings — disable streaks UI presence

**Test ID**: `STREAKS-002`

**Steps**:
1. Logged in as test user, navigate to Settings → Account tab.
2. Verify "Hide streaks" toggle is visible.
3. Verify the subtitle / help text reads warmly (not pushy).

**Expected**: Toggle present below email opt-in toggle.

---

### 2.31 Returning user — resume banner

**Test ID**: `RESUME-001`
**Persona**: returning user

**Setup**: Logged in as test user. User must have started but not completed at least 2 lessons.

**Steps**:
1. Complete lesson 1 (hello-world). Optionally start lesson 2 partially.
2. Log out.
3. Log back in.
4. Land on `/learn` dashboard.

**Expected**:
- A banner near the top reads "Pick up where you left off → Lesson X: <name>".
- Single button click jumps to that lesson.

---

### 2.32 Hint button copy (tutor tone)

**Test ID**: `HINT-001`

**Steps**:
1. Logged in as test user. Navigate to any lesson (e.g., hello-world).
2. Locate the hint button in the GuidedTutorPanel.

**Expected**:
- Button text reads "Nudge me" (NOT "Hint 1/3").
- Successive taps reveal stronger hints; second tap shows "I need more"; third shows "Walk me through it".
- No "X/3" counter visible.

---

### 2.33 Marketing page anon CTA

**Test ID**: `MARKETING-001`

**Setup**: Fresh context, NOT logged in.

**Steps**:
1. Navigate to `http://localhost:5173/`.
2. Locate the anon CTA (somewhere near the hero).

**Expected**:
- Link visible with text matching: `/Or try a lesson — no signup/i`
- Click → navigates to `/try/lesson/python-fundamentals/hello-world`.

---

### 2.34 OG image (PROBABLY STILL STALE)

**Test ID**: `MARKETING-002`

**Steps**:
1. Fetch `http://localhost:5173/og-image.png`.
2. Check the file's Last-Modified header or its visual content.

**Expected**:
- The PNG should show the new Python TypeError cinematic frame (not the old JS palindrome).
- The reference in `frontend/index.html:24,37` should be `?v=4` (not `?v=3`).

**KNOWN OUTSTANDING**: As of this test plan, the og-image regen + cache-buster bump is a USER MANUAL STEP. This test is expected to FAIL until that step lands. Mark as `expected-fail` until confirmed regen.

---

### 2.35 Cinematic CODE_LINE matches lesson 1 starter pattern

**Test ID**: `CINEMATIC-001`
**Goal**: Visual verification that the cinematic's code beat shows what lesson 1 actually teaches.

**Steps**:
1. Visit `/try/...` cold tab. Watch cinematic.
2. At the typewriter beat (~t=4s), screenshot the code area.

**Expected**:
- Code line reads: `>>> print("Hello, " + name + "!")`
- NOT `>>> print(f"Hi, {learner.name}!")` (f-string — the old broken form).

---

### 2.36 Cross-tab anon AI quota (IP-keyed)

**Test ID**: `QUOTA-001`

**Setup**: Two browser tabs, same origin.

**Steps**:
1. Tab A: visit `/try/...`, send 4 tutor questions (`q1` ... `q4`).
2. Tab B: visit `/try/...`, send 4 tutor questions (`q5` ... `q8`).
3. Tab A: send `q9`.

**Expected**:
- Both tabs share the same per-IP quota.
- The 9th question (across the two tabs) returns 429.
- Wall opens with `reason="exhausted"`.

---

### 2.37 Idempotency — repeat handoff is no-op

**Test ID**: `HANDOFF-IDEMP-001`

**Setup**: Test user has already completed handoff (lesson_progress shows hello-world completed). Test user logs out then back in.

**Steps**:
1. Pre-populate stash again (same shape as `HANDOFF-002`).
2. Login as test user.
3. Land on `/start`.
4. Watch network tab for `/api/anon-handoff` POST.

**Expected**:
- POST fires with the body.
- Response: `{ "ok": true, "applied": false }` (already-applied path).
- Page navigates to lesson 2 anyway.
- DB writes are no-ops (verify lesson_progress hasn't changed timestamp).

---

### 2.38 Handoff body validation (security)

**Test ID**: `SEC-001`

**Setup**: Logged in as test user (has a valid JWT). Use Playwright `request` API or curl with the bearer token.

**Steps** — try malicious bodies:

```bash
TOKEN="<test user's JWT>"

# 1. Wrong courseId literal — should 400
curl -X POST http://localhost:4000/api/anon-handoff \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Requested-With: codetutor" \
  -H "Origin: http://localhost:5173" \
  -H "Content-Type: application/json" \
  -d '{"courseId":"javascript-101","lessonId":"hello-world","code":"x","name":null,"flags":{"welcomeDone":true,"workspaceCoachDone":false}}'
# Expect: 400

# 2. Oversized code (5KB) — should 400
PAYLOAD=$(python3 -c "print('x'*5000)")
curl -X POST http://localhost:4000/api/anon-handoff \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Requested-With: codetutor" \
  -H "Origin: http://localhost:5173" \
  -H "Content-Type: application/json" \
  -d "{\"courseId\":\"python-fundamentals\",\"lessonId\":\"hello-world\",\"code\":\"$PAYLOAD\",\"name\":null,\"flags\":{\"welcomeDone\":true,\"workspaceCoachDone\":false}}"
# Expect: 400 OR 413 (bodyLimit)

# 3. Name with HTML angle brackets — should 400 (regex strips < > " ')
curl -X POST http://localhost:4000/api/anon-handoff \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Requested-With: codetutor" \
  -H "Origin: http://localhost:5173" \
  -H "Content-Type: application/json" \
  -d '{"courseId":"python-fundamentals","lessonId":"hello-world","code":"x","name":"<script>","flags":{"welcomeDone":true,"workspaceCoachDone":false}}'
# Expect: 400

# 4. Missing CSRF header — should 403
curl -X POST http://localhost:4000/api/anon-handoff \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"courseId":"python-fundamentals","lessonId":"hello-world","code":"x","name":null,"flags":{"welcomeDone":true,"workspaceCoachDone":false}}'
# Expect: 403

# 5. Missing Authorization — should 401
curl -X POST http://localhost:4000/api/anon-handoff \
  -H "X-Requested-With: codetutor" \
  -H "Origin: http://localhost:5173" \
  -H "Content-Type: application/json" \
  -d '{"courseId":"python-fundamentals","lessonId":"hello-world","code":"x","name":null,"flags":{"welcomeDone":true,"workspaceCoachDone":false}}'
# Expect: 401
```

To get the test user's JWT for these tests, sign in via the Supabase JS SDK or:

```bash
SUPABASE_URL="https://jizysywayotcmapgnbrc.supabase.co"
SUPABASE_ANON_KEY="sb_publishable_MPEK40v7Sy7l6KbT7r0nAw__Ha3G80g"
TOKEN=$(curl -s -X POST "${SUPABASE_URL}/auth/v1/token?grant_type=password" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"email":"phase27v2-tester@codetutor.test","password":"Phase27V2-Test-Pass-123!"}' \
  | python3 -c 'import sys, json; print(json.load(sys.stdin)["access_token"])')
echo "TOKEN=$TOKEN"
```

---

### 2.39 Migration safety (try/catch fallback) — backend resilient to dropped table

**Test ID**: `SRE-001`
**Persona**: operator

This test simulates a rolled-back `ai_anon_usage_ledger` migration. It should NOT cause every authed AI call to 500.

**Setup** — careful, this drops a table on dev:

```sql
-- Connect to dev DB, drop the table
DROP TABLE IF EXISTS public.ai_anon_usage_ledger CASCADE;
```

**Steps**:
1. Logged in as test user, navigate to a lesson.
2. Click hint button (triggers an authed AI call that internally reads the L4 cap, which queries the now-missing table).

**Expected**:
- AI call succeeds. Tutor responds normally.
- Backend logs may show a warning but no 500.

**Cleanup**: re-apply the migration:
```bash
npx supabase db push --db-url "<DATABASE_URL>" --include-all --yes
```

---

### 2.40 No "the person who said you'd never start" copy anywhere

**Test ID**: `COPY-001`
**Persona**: Alex

**Steps**:
1. Login as test user. Complete lesson 1.
2. Read every word of the LessonCompletePanel.
3. Search the live DOM for the substring "never start".

**Expected**:
- Substring NOT present anywhere on the page.
- New "Your first one" share section reads: "First program shipped. Text it to someone who'd be proud — a friend, a group chat, anyone you want to show."

---

### 2.41 Validator — practice exercises

**Test ID**: `VALIDATOR-PRACTICE-001`

**Steps**:
1. Login. Complete lesson 1.
2. From the LessonCompletePanel, start practice exercise "Two lines" (`two-lines`).
3. Write code:
   ```python
   print("Hello")
   print("World")
   ```
4. Run, then click Check.

**Expected**: Practice exercise marked as completed. Output `Hello\nWorld` matches the expected_stdout rule. (The new `forbidden_in_stdout` rule type does NOT affect this exercise — it's lesson-1 hello-world specific.)

---

### 2.42 First-run choreography state — wall-clock safety net

**Test ID**: `CHOREO-WATCHDOG-001`

**Setup**: Login as test user with welcomeDone=false. Land on /welcome → choreography starts on lesson 1.

**Steps**:
1. Reach the scripted greet. Type a real question into the tutor input mid-greet (this triggers the choreography's "user said something" cancel path).
2. Verify scripted choreography aborts gracefully.

**Expected**: Scripted greet stops typing; `welcomeDone` remains false (or flips true, depending on whether seed step ran). Page is in a usable state — not stuck in awaitRun forever.

---

### 2.43 Reduced motion (a11y)

**Test ID**: `A11Y-001`

**Setup**: Set OS reduced-motion preference to ON. Fresh context.

**Steps**:
1. Navigate to /try/.

**Expected**:
- Cinematic falls back to a static reveal (no typewriter, no glow pulse).
- (Phase 28 carryover: WorkspaceCoach motion + scripted typewriter still animate. Note as known limitation.)

---

### 2.44 Performance — page load times

**Test ID**: `PERF-001`

**Steps**:
1. Cold cache. Navigate to /try/.
2. Measure: time to first contentful paint (FCP), largest contentful paint (LCP), time-to-interactive (TTI).

**Expected** (rough budgets on local Docker):
- FCP < 1.5s
- LCP < 2.5s
- TTI < 4s
- Cinematic should mount within FCP budget (visible by 1.5s).

---

## 3. Fix-verify checklist (changes from this branch)

For each commit, walk through the changes and verify nothing else broke:

- ✅ Cinematic CODE_LINE: string concat, not f-string (CINEMATIC-001).
- ✅ Hero: anon "Your turn." with `Hello, YOUR_NAME!` output preview placeholder pulse (ANON-001) / authed "Hello, ${firstName}!" (unchanged).
- ✅ Lesson 1 validator: dual rule rejects unedited starter (ANON-007).
- ✅ Cinematic mounts on /try/ (ANON-001..003).
- ✅ WorkspaceCoach 6-step tour on /try/ (ANON-004..005, 020).
- ✅ Scripted walkthrough fires on /try/ after coach (ANON-006).
- ✅ Personalized praise turn (ANON-006 step 8).
- ✅ Check button gated on validation.passed (ANON-007, 012).
- ✅ Celebration block + Sign Up CTA writes stash (ANON-012, 013).
- ✅ Stash payload shape (ANON-013 state check).
- ✅ Wall copy: "Lesson 2 picks up right where you are…" (ANON-013).
- ✅ Handoff endpoint: idempotent + RLS-scoped (HANDOFF-001, IDEMP-001).
- ✅ StartPage handoff intercept: holds /welcome redirect (HANDOFF-001).
- ✅ Loading shell: "Carrying your work over…" (HANDOFF-001).
- ✅ Failure-path fallback (HANDOFF-002).
- ✅ Local prefs store patched post-success (HANDOFF-003).
- ✅ Direct signup unchanged (DIRECT-001).
- ✅ Raw-JSON streaming bubble fix (ANON-021).
- ✅ Kill switch (ANON-023).
- ✅ Mobile coach step 1 visible (ANON-020).
- ✅ Alex YA-novel copy stripped (COPY-001).

---

## 4. Known limitations / Phase 28 carryovers

These are NOT bugs in v2. Tests for them should be marked as "expected limitation":

- WorkspaceCoach + scripted typewriter ignore reduced-motion (A11Y-001 partial).
- SignupWallDialog + LessonCompletePanel have aria-modal but no actual focus trap.
- Touch targets <44×44px on header / Save / Run buttons.
- Tutor message log lacks `role="log" aria-live="polite"`.
- Anon /api/anon/run accepts all 9 languages (Python-only intent).
- Anon lessonContext is client-supplied (server should load canonical).
- No TTL sweep on ai_anon_usage_ledger.
- No Origin/Referer check on /api/anon/* (only on authed mounts).
- iOS soft-keyboard pushes layout (use `min-h-dvh` instead of `min-h-screen`).
- og-image still stale (USER MANUAL STEP outstanding).

---

## 5. Reporting format

For each test, capture:

```yaml
test_id: ANON-006
status: PASS | FAIL | SKIP
duration_ms: 12345
screenshots:
  - t=0s.png
  - t=10s.png
notes: ""
failure_evidence: |
  (only if FAIL)
  Expected: praise turn says "Perfect, Maya"
  Actual: praise turn said "Perfect, there"
  Console errors: ...
  Network: ...
```

Roll up into a final summary by category (anon flow, handoff, signup paths, security, perf).

---

## 6. Quick smoke (5-test minimal pass)

If full suite isn't feasible, run these 5 to catch the load-bearing v2 contracts:

1. `ANON-007` — validator rejects unedited starter (the v1 trust break)
2. `ANON-012` — celebration block personalizes correctly
3. `HANDOFF-001` — handoff lands user on lesson 2, NOT /welcome
4. `HANDOFF-002` — handoff failure falls through cleanly
5. `DIRECT-001` — Alex's path unchanged

If all 5 pass, v2 is structurally correct.
