# Release B4 distribution packet

Status: implementation complete locally; merge CI and deployment proof pending

Prepared: 2026-07-30
Outcome owner: growth/product

## Product change

CodeTutor now turns the existing structured curriculum into a public learning
library without maintaining a second copy of the lessons. Visitors and search
crawlers can browse three courses and 38 lesson walkthroughs, then enter the
real anonymous lesson from a clear call to action. The category promise is
“Built to teach, not to autocomplete,” supported by the shipped read → make →
ask loop and the existing authored checks/tutor constraints.

Generated production routes:

- `/learn-to-code/` — category and product-method page;
- `/learn-to-code/<courseId>/` — ordered course page;
- `/lessons/<courseId>/<lessonId>/` — lesson walkthrough;
- `/lesson-og/<courseId>/<lessonId>.png` — unique 1200 × 630 social image;
- `/sitemap.xml`, `/robots.txt`, and `/discovery.css`.

Every lesson document has a unique raw HTML title, description, canonical URL,
Open Graph/Twitter metadata, `LearningResource`/`Course` structured data, and
normal internal links. Unknown reserved paths return a real 404. Courses marked
internal are absent from pages, sitemap, public registry, and copied production
course assets.

## Acquisition and privacy contract

The browser accepts only these first-touch shapes:

- `direct`;
- `organic` with `lesson_page` or `category_page` plus bounded slugs;
- `share` with `lesson_share`, bounded course/lesson slugs, and a 12-character
  share reference.

The first valid acquisition touch is kept in session storage and its query
parameters are immediately removed from the visible URL. The client attaches
that fixed shape to the six anonymous funnel signals: landing, first run,
lesson completion, wall open, signup, and lesson 2. The server validates the
same closed union and stores only coarse fields. It never stores a raw referrer
URL or share token; share correlation uses a domain-separated SHA-256 hash.
Malformed or unavailable client storage falls back to `direct`, and telemetry
always fails open so learning is never blocked.

The admin trial-path panel reports direct/organic/share cohorts through landing,
run, completion, signup, and lesson 2. Wall opens are displayed separately from
completion because a learner may open the wall before completing.

## Data and security changes

- `20260731051434_add_distribution_attribution.sql` adds bounded acquisition
  columns, the two activation events, coherent source/medium constraints, and a
  source/event/time index to the deny-all-RLS funnel table.
- `20260731053206_harden_function_execute_privileges.sql` removes two obsolete
  remote-only share helpers, revokes API-role execution from trigger/maintenance
  functions, preserves trusted server execution, and fixes the mutable search
  path on `touch_updated_at`.
- `20260731053449_optimize_distribution_funnel_index.sql` orders the reporting
  index by the UTC time range before its low-cardinality cohort fields.
- All migrations were applied to the linked `codetutor-dev` project. Local and
  remote migration histories align. Production remains a deployment action,
  not an assumption from dev evidence.
- The linked security advisor is clear except for the project setting that
  leaked-password protection is disabled; enabling that setting is an operator
  follow-up independent of B4. Existing RLS performance advisories are not
  release regressions and remain separate optimization work.

## Verification evidence

- catalog/build unit suite: 3 public courses, 38 lessons, internal exclusion,
  unique document contracts, safe Markdown rendering, and real PNG dimensions;
- frontend and backend type checks;
- production frontend build emitting 3 course pages, 38 lesson pages, and 38
  lesson images;
- real `codetutor-dev` telemetry integration covering legacy direct events,
  strict rejection, hashed share attribution, first run, and completion;
- critical-lane inventory: 39 tests across 14 files with the frozen P0/P1
  corpus and three migration pilots intact;
- focused Chromium B4 browser suite with retries disabled: raw crawler contract,
  390 px layout, serious/critical axe scan, no horizontal overflow, course-to-
  lesson navigation, and first-touch carry-through all pass;
- production dependency audit: no unreviewed high/critical runtime advisory.

## Deployment and outcome gate

Before declaring the engineering release deployed:

1. all PR checks and review threads are green/resolved;
2. the production candidate contains the generated routes and exact migrations;
3. raw production HTML, sitemap, one lesson image, an internal-course 404, and
   the anonymous CTA journey are rechecked;
4. the search property receives the sitemap and indexing is observed rather
   than assumed;
5. channel counts are watched for malformed/unknown values and ingestion abuse.

B4 proves crawler correctness and attribution integrity. Organic impressions,
traffic, activation, and share outcomes require the locked post-indexing
observation window; this packet makes no pre-launch growth claim.
