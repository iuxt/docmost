import {
  Alert,
  Button,
  Group,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ResponsiveSettingsRow } from "@/components/ui/responsive-settings-row.tsx";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom.ts";
import {
  getTypesenseSettings,
  saveTypesenseSettings,
  testTypesenseSettings,
  updateWorkspace,
} from "@/features/workspace/services/workspace-service.ts";
import { getApiErrorMessage } from "@/lib/api-error.ts";
import useUserRole from "@/hooks/use-user-role.tsx";

export default function WorkspaceSearchSettings() {
  const { t } = useTranslation();
  const { isAdmin } = useUserRole();
  const [workspace, setWorkspace] = useAtom(workspaceAtom);
  const [saving, setSaving] = useState(false);
  const [connectionAction, setConnectionAction] = useState<
    "save" | "test" | null
  >(null);
  const [locale, setLocale] = useState("zh");
  const queryClient = useQueryClient();
  const settingsKey = ["typesense-settings", workspace?.id];
  const settings = useQuery({
    queryKey: settingsKey,
    queryFn: getTypesenseSettings,
    enabled: Boolean(workspace) && isAdmin,
    refetchOnWindowFocus: false,
    retry: false,
  });
  useEffect(() => {
    if (settings.data) {
      setLocale(settings.data.locale);
    }
  }, [settings.data]);
  const enabled = workspace?.searchDriver === "typesense";
  const configured =
    settings.data?.configured ?? workspace?.typesenseConfigured === true;

  const refreshSearch = () =>
    queryClient.invalidateQueries({
      predicate: ({ queryKey }) =>
        [
          "unified-search",
          "page-search",
          "share-search",
          "public-space-search",
        ].includes(String(queryKey[0])),
    });

  const handleChange = async (checked: boolean) => {
    if (!isAdmin) return;
    setSaving(true);
    try {
      const updatedWorkspace = await updateWorkspace({
        searchDriver: checked ? "typesense" : "database",
      });
      setWorkspace(updatedWorkspace);
      queryClient.setQueryData(["workspace"], updatedWorkspace);
      await refreshSearch();
    } catch (error) {
      notifications.show({
        message: getApiErrorMessage(error, t("Failed to update setting")),
        color: "red",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleConnection = async (action: "save" | "test") => {
    if (!isAdmin) return;
    setConnectionAction(action);
    const data = {
      locale: locale.trim().toLowerCase(),
    };
    try {
      if (action === "test") {
        await testTypesenseSettings(data);
        notifications.show({
          message: t("Typesense connection successful."),
          color: "green",
        });
      } else {
        const saved = await saveTypesenseSettings(data);
        queryClient.setQueryData(settingsKey, saved);
        if (workspace) {
          const updated = {
            ...workspace,
            typesenseConfigured: saved.configured,
          };
          setWorkspace(updated);
          queryClient.setQueryData(["workspace"], updated);
        }
        await refreshSearch();
        notifications.show({
          message: t(
            "Typesense settings saved. Existing pages are being indexed.",
          ),
          color: "green",
        });
      }
    } catch (error) {
      notifications.show({
        message: getApiErrorMessage(error, t("Failed to update setting")),
        color: "red",
      });
    } finally {
      setConnectionAction(null);
    }
  };

  const busy = saving || connectionAction !== null;
  const canSubmit = configured && Boolean(locale.trim()) && !settings.isPending;

  return (
    <Stack gap="md">
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
          disabled={!isAdmin || busy || !workspace || (!configured && !enabled)}
          onChange={(event) => void handleChange(event.currentTarget.checked)}
          aria-label={t("Use Typesense search")}
        />
      </ResponsiveSettingsRow>
      {isAdmin && settings.isError && (
        <Alert color="red">
          {t("Failed to load Typesense settings.")}{" "}
          <Button
            variant="subtle"
            size="xs"
            onClick={() => void settings.refetch()}
          >
            {t("Retry")}
          </Button>
        </Alert>
      )}
      {isAdmin && (
        <Stack gap="sm" maw={560}>
          <TextInput
            label={t("Typesense language")}
            description={t(
              "Use zh for Chinese or en for English. Changing the language rebuilds the index.",
            )}
            value={locale}
            onChange={(event) => setLocale(event.currentTarget.value)}
            disabled={
              !configured || settings.isPending || settings.isError || busy
            }
          />
          <Group>
            <Button
              variant="default"
              loading={connectionAction === "test"}
              disabled={!canSubmit || busy || settings.isError}
              onClick={() => void handleConnection("test")}
            >
              {t("Test connection")}
            </Button>
            <Button
              loading={connectionAction === "save"}
              disabled={!canSubmit || busy || settings.isError}
              onClick={() => void handleConnection("save")}
            >
              {t("Save settings")}
            </Button>
          </Group>
        </Stack>
      )}
    </Stack>
  );
}
