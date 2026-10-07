import { onRequest as handleApiRequest } from "./[[path]].js";

export async function onRequestPost(context) {
  return handleApiRequest(context);
}
