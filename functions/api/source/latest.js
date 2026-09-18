import { onRequest as handleSourceRequest } from "./[[path]].js";

export async function onRequestGet(context) {
  return handleSourceRequest(context);
}
