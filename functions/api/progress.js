import { onRequest as handleApiRequest } from "./[[path]].js";

export async function onRequestPut(context) {
  return handleApiRequest(context);
}
