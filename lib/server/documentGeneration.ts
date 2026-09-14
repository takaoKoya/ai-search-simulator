import crypto from "crypto";
import type { TenantContext } from "@/lib/server/tenant";
import { NotFoundError, ValidationError } from "@/lib/server/errors";
import { renderProposalPdf } from "@/lib/documents/proposalPdf";
import { renderProposalPptx } from "@/lib/documents/proposalPptx";
import type { ProposalDocumentInput } from "@/lib/documents/proposalDocument";
import { encodeBytea } from "@/lib/server/bytea";

export type GeneratedFileType = "PDF" | "PPTX";

const CLIENT_VISIBLE_STATUSES = ["APPROVED", "SENT", "ACCEPTED"];

/**
 * Renders + stores a proposal document from the proposal's content_json —
 * the Source of Truth (spec §37-38) — never re-derived from live DB fields
 * that could have moved on since this version was approved, so a PDF/PPTX
 * never silently changes after the fact even if the proposal later gets a
 * new version. Classification follows the proposal's own status: only
 * APPROVED/SENT/ACCEPTED becomes CLIENT_VISIBLE (shareable, spec §48);
 * everything else (DRAFT, WAITING_APPROVAL, INTERNAL_REVIEW, ...) stays
 * INTERNAL.
 */
export async function generateProposalFile(ctx: TenantContext, proposalId: string, fileType: GeneratedFileType): Promise<{ fileId: string; classification: string }> {
  const { supabase, tenantId } = ctx;

  const { data: proposal, error } = await supabase.from("proposals").select("id, opportunity_id, status, content_json").eq("id", proposalId).eq("tenant_id", tenantId).maybeSingle();
  if (error) throw error;
  if (!proposal) throw new NotFoundError("Proposal not found");
  if (!proposal.content_json) throw new ValidationError("Proposal has no content_json yet (nothing to render)");

  const { data: estimate } = await supabase
    .from("estimates")
    .select("content_json")
    .eq("proposal_id", proposalId)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: opportunity } = await supabase.from("opportunities").select("lead_id").eq("id", proposal.opportunity_id as string).eq("tenant_id", tenantId).maybeSingle();
  const lead = opportunity ? (await supabase.from("leads").select("company_name").eq("id", opportunity.lead_id as string).eq("tenant_id", tenantId).maybeSingle()).data : null;

  const proposalContent = proposal.content_json as Record<string, unknown>;
  const estimateContent = (estimate?.content_json as Record<string, unknown> | undefined) ?? null;

  const input: ProposalDocumentInput = {
    companyName: (lead?.company_name as string | undefined) ?? "対象企業",
    title: String(proposalContent.title ?? ""),
    executiveSummary: String(proposalContent.executiveSummary ?? ""),
    clientChallenges: (proposalContent.clientChallenges as string[] | undefined) ?? [],
    goals: (proposalContent.goals as string[] | undefined) ?? [],
    recommendedSolution: String(proposalContent.recommendedSolution ?? ""),
    scope: (proposalContent.scope as string[] | undefined) ?? [],
    deliverables: (proposalContent.deliverables as string[] | undefined) ?? [],
    timeline: (proposalContent.timeline as Array<{ phase: string; period: string }> | undefined) ?? [],
    kpis: (proposalContent.kpis as string[] | undefined) ?? [],
    nextStep: String(proposalContent.nextStep ?? ""),
    estimate: estimateContent
      ? {
          lineItems: ((estimateContent.lineItems as Array<{ service: string; unitPrice: number; amount: number }> | undefined) ?? []).map((li) => ({
            service: li.service,
            unitPrice: li.unitPrice,
            amount: li.amount,
          })),
          subtotal: Number(estimateContent.subtotal ?? 0),
          discount: Number(estimateContent.discount ?? 0),
          tax: Number(estimateContent.tax ?? 0),
          total: Number(estimateContent.total ?? 0),
        }
      : null,
  };

  const fileData = fileType === "PDF" ? await renderProposalPdf(input) : await renderProposalPptx(input);
  const checksum = crypto.createHash("sha256").update(fileData).digest("hex");
  const classification = CLIENT_VISIBLE_STATUSES.includes(proposal.status as string) ? "CLIENT_VISIBLE" : "INTERNAL";
  const extension = fileType === "PDF" ? "pdf" : "pptx";

  const { data: fileRow, error: insertError } = await supabase
    .from("generated_files")
    .insert({
      tenant_id: tenantId,
      opportunity_id: proposal.opportunity_id,
      entity_type: "proposal",
      entity_id: proposalId,
      version_id: proposalId,
      file_type: fileType,
      storage_path: `proposals/${proposalId}.${extension}`,
      file_data: encodeBytea(fileData),
      checksum,
      byte_size: fileData.length,
      classification,
    })
    .select("id")
    .single();
  if (insertError || !fileRow) throw insertError ?? new Error("Failed to store generated file");

  await supabase.from("agent_events").insert({
    tenant_id: tenantId,
    event_type: "generated_file.created",
    message: `提案書の${fileType}を生成しました（${classification}）`,
    payload: { fileId: fileRow.id, proposalId, fileType, classification },
  });

  return { fileId: fileRow.id as string, classification };
}
