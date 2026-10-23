import { IdInput, ImportApplyInput, ImportCreateInput, ImportDetail, ImportListInput, ImportSummary } from "@scope/shared";
import { z } from "zod";
import { applyImport, createImport, discardImport, getImportDetail, listImports } from "../../services/imports";
import { authedProcedure, authedProcedureWithoutTx, requireTheater, router } from "../init";

const tags = ["imports"];

/** Every import procedure is admin-only for the theater; RLS enforces the same. */
export const importsRouter = router({
  // The agent's model call can take tens of seconds, so no transaction is held open across it.
  create: authedProcedureWithoutTx
    .meta({
      openapi: {
        method: "POST",
        path: "/theaters/{theaterId}/imports",
        tags,
        protect: true,
        summary: "Upload a partner CSV and get a preview of the changes",
      },
    })
    .input(ImportCreateInput)
    .output(ImportDetail)
    .mutation(({ ctx, input }) => {
      requireTheater(ctx, input.theaterId, "import.manage");
      return createImport(ctx, input);
    }),

  list: authedProcedure
    .meta({ openapi: { method: "GET", path: "/theaters/{theaterId}/imports", tags, protect: true } })
    .input(ImportListInput)
    .output(z.array(ImportSummary))
    .query(({ ctx, input }) => {
      requireTheater(ctx, input.theaterId, "import.manage");
      return listImports(ctx, input.theaterId);
    }),

  get: authedProcedure
    .meta({ openapi: { method: "GET", path: "/imports/{id}", tags, protect: true } })
    .input(IdInput)
    .output(ImportDetail)
    .query(({ ctx, input }) => getImportDetail(ctx, input.id)),

  commit: authedProcedure
    .meta({ openapi: { method: "POST", path: "/imports/{id}/apply", tags, protect: true } })
    .input(ImportApplyInput)
    .output(ImportDetail)
    .mutation(({ ctx, input }) => applyImport(ctx, input.id, input.confirmLargeArchive, input.decisions)),

  discard: authedProcedure
    .meta({ openapi: { method: "DELETE", path: "/imports/{id}", tags, protect: true } })
    .input(IdInput)
    .output(ImportDetail)
    .mutation(({ ctx, input }) => discardImport(ctx, input.id)),
});
