import { handleApi } from "~/server/api-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // large CSV imports

export {
  handleApi as DELETE,
  handleApi as GET,
  handleApi as HEAD,
  handleApi as OPTIONS,
  handleApi as PATCH,
  handleApi as POST,
  handleApi as PUT,
};
