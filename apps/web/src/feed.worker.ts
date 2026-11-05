/// <reference lib="webworker" />
import { serveLiveFeed } from "@transmi/infrastructure";
import { CONFIG } from "./config";
import { makeCachedFetch } from "./offline-cache";

serveLiveFeed(self as unknown as Parameters<typeof serveLiveFeed>[0], {
  primaryBase: CONFIG.proxyUrl, fallbackBase: CONFIG.dataBase, fetchFn: makeCachedFetch({ onlyOffline: true }), waitSeconds: 20,
});
