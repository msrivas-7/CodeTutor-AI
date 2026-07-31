import type { Plugin, ViteDevServer } from "vite";
import path from "node:path";
import {
  discoveryCss,
  generateDiscoverySite,
  loadDiscoveryCatalog,
  renderCategoryPage,
  renderCoursePage,
  renderLessonPage,
  renderRobots,
  renderSitemap,
} from "./discoverySite";
import { renderLessonOgPng } from "./discoveryOg";

function redirectTrailingSlash(server: ViteDevServer, reqUrl: string, res: import("node:http").ServerResponse): boolean {
  const pathname = new URL(reqUrl, "http://localhost").pathname;
  if ((pathname === "/learn-to-code" || pathname.startsWith("/learn-to-code/") || pathname.startsWith("/lessons/")) && !pathname.endsWith("/") && !path.extname(pathname)) {
    res.statusCode = 308;
    res.setHeader("Location", `${pathname}/${new URL(reqUrl, "http://localhost").search}`);
    res.end();
    server.config.logger.info(`[discovery] canonical redirect ${pathname}/`);
    return true;
  }
  return false;
}

export function isReservedDiscoveryPath(pathname: string): boolean {
  return (
    pathname.startsWith("/learn-to-code/") ||
    pathname.startsWith("/lessons/") ||
    pathname.startsWith("/lesson-og/")
  );
}

export function discoverySitePlugin(): Plugin {
  const frontendRoot = process.cwd();
  const coursesDir = path.join(frontendRoot, "public", "courses");
  return {
    name: "codetutor:discovery-site",
    apply: "serve",
    configureServer(server) {
      const pngCache = new Map<string, Buffer>();
      server.middlewares.use(async (req, res, next) => {
        if (!req.url) return next();
        if (redirectTrailingSlash(server, req.url, res)) return;
        const pathname = new URL(req.url, "http://localhost").pathname;
        const catalog = loadDiscoveryCatalog(coursesDir);
        let body: string | Buffer | null = null;
        let contentType = "text/html; charset=utf-8";

        if (pathname === "/learn-to-code/") body = renderCategoryPage(catalog);
        else if (pathname === "/sitemap.xml") {
          body = renderSitemap(catalog);
          contentType = "application/xml; charset=utf-8";
        } else if (pathname === "/robots.txt") {
          body = renderRobots();
          contentType = "text/plain; charset=utf-8";
        } else if (pathname === "/discovery.css") {
          body = discoveryCss();
          contentType = "text/css; charset=utf-8";
        } else {
          const courseMatch = pathname.match(/^\/learn-to-code\/([a-z0-9][a-z0-9_-]*)\/$/);
          const lessonMatch = pathname.match(/^\/lessons\/([a-z0-9][a-z0-9_-]*)\/([a-z0-9][a-z0-9_-]*)\/$/);
          const ogMatch = pathname.match(/^\/lesson-og\/([a-z0-9][a-z0-9_-]*)\/([a-z0-9][a-z0-9_-]*)\.png$/);
          if (courseMatch) {
            const course = catalog.publicCourses.find((item) => item.id === courseMatch[1]);
            if (course) body = renderCoursePage(course);
            else {
              res.statusCode = 404;
              res.end("Not found");
              return;
            }
          } else if (lessonMatch || ogMatch) {
            const match = lessonMatch ?? ogMatch!;
            const course = catalog.publicCourses.find((item) => item.id === match[1]);
            const lesson = course?.lessons.find((item) => item.id === match[2]);
            if (!course || !lesson) {
              res.statusCode = 404;
              res.end("Not found");
              return;
            }
            if (lessonMatch) body = renderLessonPage(course, lesson);
            else {
              let png = pngCache.get(pathname);
              if (!png) {
                png = await renderLessonOgPng({
                  courseTitle: course.title,
                  lessonTitle: lesson.title,
                  lessonOrder: lesson.order,
                  totalLessons: course.lessons.length,
                  description: lesson.description,
                  language: lesson.language,
                  concepts: lesson.teachesConceptTags,
                });
                pngCache.set(pathname, png);
              }
              body = png;
              contentType = "image/png";
            }
          }
        }

        if (body === null && isReservedDiscoveryPath(pathname)) {
          res.statusCode = 404;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("Not found");
          return;
        }
        if (body === null) return next();
        res.statusCode = 200;
        res.setHeader("Content-Type", contentType);
        res.setHeader("Cache-Control", contentType === "image/png" ? "public, max-age=3600" : "no-cache");
        res.end(body);
      });
    },
  };
}

export function discoveryBuildPlugin(): Plugin {
  const frontendRoot = process.cwd();
  return {
    name: "codetutor:discovery-build",
    apply: "build",
    async closeBundle() {
      const outDir = path.resolve(frontendRoot, "dist");
      const catalog = await generateDiscoverySite({
        coursesDir: path.join(frontendRoot, "public", "courses"),
        outDir,
      });
      const lessonCount = catalog.publicCourses.reduce((sum, course) => sum + course.lessons.length, 0);
      this.info(`[discovery] emitted ${catalog.publicCourses.length} course pages, ${lessonCount} lesson pages, and ${lessonCount} OG images`);
    },
  };
}
