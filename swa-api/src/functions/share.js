import { app } from "@azure/functions";
import { handleSharePage } from "../sharePage.js";

app.http("share-unfurl", {
  methods: ["GET", "HEAD"],
  authLevel: "anonymous",
  route: "share/{token}",
  handler: handleSharePage,
});
