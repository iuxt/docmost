import { Switch, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQueryClient } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ResponsiveSettingsRow } from "@/components/ui/responsive-settings-row.tsx";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom.ts";
import { updateWorkspace } from "@/features/workspace/services/workspace-service.ts";
import { getApiErrorMessage } from "@/lib/api-error.ts";

export default function WorkspaceSearchSettings() {
  const { t } = useTranslation();
  const [workspace, setWorkspace] = useAtom(workspaceAtom);
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();
  const enabled = workspace?.searchDriver === "typesense";
  const configured = workspace?.typesenseConfigured === true;

  const handleChange = async (checked: boolean) => {
    setSaving(true);
    try {
      const updatedWorkspace = await updateWorkspace({
        searchDriver: checked ? "typesense" : "database",
      });
      setWorkspace(updatedWorkspace);
      queryClient.setQueryData(["workspace"], updatedWorkspace);
      await queryClient.invalidateQueries({
        predicate: ({ queryKey }) =>
          [
            "unified-search",
            "page-search",
            "share-search",
            "public-space-search",
          ].includes(String(queryKey[0])),
      });
    } catch (error) {
      notifications.show({
        message: getApiErrorMessage(error, t("Failed to update setting")),
        color: "red",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResponsiveSettingsRow>
      <div style={{ flex: "1 1 300px" }}>
        <Text size="md">{t("Use Typesense search")}</Text>
        <Text size="sm" c="dimmed">
          {t(
            "Search page titles and content with Typesense in this workspace. Turn off to use database search.",
          )}
        </Text>
        <Text size="sm" c="dimmed" mt={4}>
          {configured
            ? t(
                "Existing pages are indexed in the background. Search results may be incomplete until indexing finishes.",
              )
            : t(
                "Typesense is not configured on this server. Contact your administrator.",
              )}
        </Text>
      </div>
      <Switch
        checked={enabled}
        disabled={saving || !workspace || (!configured && !enabled)}
        onChange={(event) => void handleChange(event.currentTarget.checked)}
        aria-label={t("Use Typesense search")}
      />
    </ResponsiveSettingsRow>
  );
}
