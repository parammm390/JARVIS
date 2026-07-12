// marketing domain plugin — summarize_ad_performance is interface-only (Meta/Google Ads
// APIs need app-review approval); campaign sends stay scaffolded until rules exist.
import { createStubPlugin } from "../shared/plugin-interface";
import { z } from "zod";

export const marketingPolicySchema = z.object({}).passthrough();
export const marketingPlugin = createStubPlugin("marketing", [
  "summarize_ad_performance",
  "send_campaign",
  "create_review_request",
]);
export default marketingPlugin;
