import { createSpotlight } from "@mantine/spotlight";

export const SEARCH_QUERY_MAX_LENGTH = 200;

export const [searchSpotlightStore, searchSpotlight] = createSpotlight();

export const [shareSearchSpotlightStore, shareSearchSpotlight] =
  createSpotlight();

export const [publicSpaceSearchSpotlightStore, publicSpaceSearchSpotlight] =
  createSpotlight();
