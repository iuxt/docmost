import { Text, SegmentedControl } from "@mantine/core";
import { useAtom } from "jotai";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom.ts";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { updateWorkspace } from "@/features/workspace/services/workspace-service.ts";
import { notifications } from "@mantine/notifications";
import { getApiErrorMessage } from "@/lib/api-error.ts";
import { PageEditMode } from "@/features/user/types/user.types.ts";
import useUserRole from "@/hooks/use-user-role.tsx";
import {
  ResponsiveSettingsRow,
  ResponsiveSettingsContent,
  ResponsiveSettingsControl,
} from "@/components/ui/responsive-settings-row.tsx";

export default function WorkspaceDefaultPageEditMode() {
  const { t } = useTranslation();

  return (
    <ResponsiveSettingsRow>
      <ResponsiveSettingsContent>
        <Text size="md">{t("Default page edit mode")}</Text>
        <Text size="sm" c="dimmed">
          {t(
            "Choose the page edit mode new members start with. Existing members are not affected.",
          )}
        </Text>
      </ResponsiveSettingsContent>

      <ResponsiveSettingsControl>
        <DefaultPageEditModeControl />
      </ResponsiveSettingsControl>
    </ResponsiveSettingsRow>
  );
}

function DefaultPageEditModeControl() {
  const { t } = useTranslation();
  const { isAdmin } = useUserRole();
  const [saving, setSaving] = useState(false);
  const [workspace, setWorkspace] = useAtom(workspaceAtom);
  const defaultPageEditMode =
    workspace?.settings?.defaultPageEditMode ?? PageEditMode.Edit;
  const [value, setValue] = useState<string>(defaultPageEditMode);

  const handleChange = async (newValue: string) => {
    if (!isAdmin || saving) return;
    const prevValue = value;
    setValue(newValue);
    setSaving(true);
    try {
      const updatedWorkspace = await updateWorkspace({
        defaultPageEditMode: newValue,
      });
      setWorkspace(updatedWorkspace);
    } catch (err) {
      setValue(prevValue);
      notifications.show({
        message: getApiErrorMessage(err, t("Failed to update setting")),
        color: "red",
      });
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    setValue(defaultPageEditMode);
  }, [defaultPageEditMode]);

  return (
    <SegmentedControl
      aria-label={t("Default page edit mode")}
      value={value}
      disabled={!isAdmin || saving}
      onChange={handleChange}
      data={[
        { label: t("Edit"), value: PageEditMode.Edit },
        { label: t("Read"), value: PageEditMode.Read },
      ]}
    />
  );
}
