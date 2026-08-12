/* CreateSkillModal — merges the accepted conventions into ONE editable skill.

   The server builds the draft (`GET /repos/:id/conventions/skill-draft`); every
   field here is editable before saving. Saving goes through the existing
   `POST /skills` — this feature adds no skill-creation endpoint of its own.
   The conventions list is left untouched on success. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Button,
  ErrorState,
  FormField,
  Icon,
  Modal,
  SelectInput,
  Skeleton,
  Textarea,
  TextInput,
  Toggle,
} from "@devdigest/ui";
import { useSkillDraft } from "@/lib/hooks/conventions";
import { useCreateSkill } from "@/lib/hooks/skills";
import { s } from "../styles";

const TYPES = [
  { value: "convention", label: "convention" },
  { value: "rubric", label: "rubric" },
  { value: "security", label: "security" },
  { value: "custom", label: "custom" },
] as const;

/** Derived from TYPES so the two can never drift — no cast at submit. */
type SkillTypeValue = (typeof TYPES)[number]["value"];

/** Rough token estimate for the body header — 4 chars ≈ 1 token. */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function CreateSkillModal({
  repoId,
  repoName,
  onClose,
}: {
  repoId: string;
  repoName: string;
  onClose: () => void;
}) {
  const t = useTranslations("conventions");
  const router = useRouter();
  const { data: draft, isLoading, isError } = useSkillDraft(repoId, true);
  const create = useCreateSkill();

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillTypeValue>("convention");
  const [enabled, setEnabled] = React.useState(true);
  const [body, setBody] = React.useState("");
  const [dirty, setDirty] = React.useState(false);

  // Seed the form once the draft lands; never clobber in-flight edits.
  React.useEffect(() => {
    if (!draft || dirty) return;
    setName(draft.name);
    setDescription(draft.description);
    setType(draft.type);
    setBody(draft.body);
  }, [draft, dirty]);

  const edit = <T,>(setter: (v: T) => void) => (v: T) => {
    setDirty(true);
    setter(v);
  };

  const submit = () => {
    create.mutate(
      {
        name: name.trim(),
        description: description.trim(),
        type,
        source: "extracted",
        body,
        enabled,
      },
      { onSuccess: (skill) => router.push(`/skills/${skill.id}?tab=config`) }
    );
  };

  const canSubmit = name.trim().length > 0 && body.trim().length > 0 && !create.isPending;

  return (
    <Modal
      width={760}
      title={t("modal.title")}
      subtitle={name || repoName}
      onClose={onClose}
      footer={
        <div style={s.modalFooter}>
          <span style={s.footerNote}>
            <Icon.GitCommit size={12} style={{ verticalAlign: -2, marginRight: 6 }} />
            {t("modal.savedAs")}
          </span>
          <Button kind="secondary" size="sm" onClick={onClose}>
            {t("modal.cancel")}
          </Button>
          <Button
            kind="primary"
            size="sm"
            icon="Sparkles"
            disabled={!canSubmit}
            loading={create.isPending}
            onClick={submit}
          >
            {create.isPending ? t("modal.creating") : t("modal.submit")}
          </Button>
        </div>
      }
    >
      <div style={s.modalBody}>
        {isLoading && <Skeleton height={320} />}
        {isError && <ErrorState body={t("modal.draftError")} />}

        {draft && !isError && (
          <>
            <div style={s.banner}>
              <Icon.Wrench size={14} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                {t("modal.mergedFrom", { count: draft.accepted_count, repo: repoName })}
              </span>
            </div>

            <FormField label={t("modal.name")} required>
              <TextInput value={name} onChange={edit(setName)} />
            </FormField>

            <FormField label={t("modal.description")}>
              <TextInput value={description} onChange={edit(setDescription)} />
            </FormField>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
              <FormField label={t("modal.type")}>
                <SelectInput
                  value={type}
                  onChange={(v) => edit(setType)(v as SkillTypeValue)}
                  options={TYPES as unknown as { value: string; label: string }[]}
                />
              </FormField>
              <FormField label={t("modal.enabled")} hint={t("modal.enabledHint")}>
                <Toggle on={enabled} onChange={edit(setEnabled)} />
              </FormField>
            </div>

            <FormField label={t("modal.body")} required>
              <div>
                <div style={s.bodyHead}>
                  <Icon.FileText size={13} />
                  <span className="mono">{name || draft.name}.md</span>
                  <span style={{ marginLeft: "auto" }} className="tnum">
                    {t("modal.tokens", { count: estimateTokens(body) })}
                  </span>
                </div>
                <Textarea value={body} onChange={edit(setBody)} rows={14} mono />
              </div>
            </FormField>

            {create.isError && (
              <div style={{ fontSize: 13, color: "var(--crit)" }}>{t("modal.createFailed")}</div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
