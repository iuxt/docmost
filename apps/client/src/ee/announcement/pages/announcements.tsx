import { useState } from "react";
import { Alert, Button, Group, Space, Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconAlertCircle } from "@tabler/icons-react";
import { useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";
import SettingsTitle from "@/components/settings/settings-title";
import Paginate from "@/components/common/paginate";
import { DocumentTitle } from "@/components/ui/document-title.tsx";
import { SearchInput } from "@/components/common/search-input";
import { usePaginateAndSearch } from "@/hooks/use-paginate-and-search";
import useUserRole from "@/hooks/use-user-role.tsx";
import { getApiErrorMessage } from "@/lib/api-error";
import { capabilitiesAtom } from "@/features/workspace/capabilities/capabilities-atom";
import { Feature } from "@/ee/features";
import { useHasFeature } from "@/ee/hooks/use-feature";
import { AnnouncementArchiveFilter } from "@/ee/announcement/components/announcement-archive-filter";
import { AnnouncementFormModal } from "@/ee/announcement/components/announcement-form-modal";
import { AnnouncementTable } from "@/ee/announcement/components/announcement-table";
import {
  isNotFound,
  useAnnouncementsQuery,
  useArchiveAnnouncementMutation,
  useDeleteAnnouncementMutation,
  useUnarchiveAnnouncementMutation,
} from "@/ee/announcement/queries/announcement-query";
import type { IAnnouncement } from "@/ee/announcement/types/announcement.types";

export default function Announcements() {
  const { t } = useTranslation();
  const { isAdmin } = useUserRole();
  const hasFeature = useHasFeature(Feature.ANNOUNCEMENTS);
  const capabilities = useAtomValue(capabilitiesAtom);
  const { search, cursor, goNext, goPrev, handleSearch, resetPagination } =
    usePaginateAndSearch();
  const [archived, setArchived] = useState(false);
  const [formOpened, setFormOpened] = useState(false);
  const [selected, setSelected] = useState<IAnnouncement | null>(null);
  const canLoad = isAdmin && hasFeature;
  const query = useAnnouncementsQuery(
    {
      cursor,
      limit: 20,
      query: search,
      ...(archived ? { archived: true } : {}),
    },
    canLoad,
  );
  const archiveMutation = useArchiveAnnouncementMutation();
  const unarchiveMutation = useUnarchiveAnnouncementMutation();
  const deleteMutation = useDeleteAnnouncementMutation();

  if (!isAdmin || !hasFeature) {
    return null;
  }

  const openForm = (announcement: IAnnouncement | null) => {
    setSelected(announcement);
    setFormOpened(true);
  };

  const confirmDelete = (announcement: IAnnouncement) =>
    modals.openConfirmModal({
      title: t("Delete announcement"),
      centered: true,
      children: (
        <Text size="sm">
          {t("“{{name}}” will be permanently deleted.", {
            name: announcement.title,
          })}
        </Text>
      ),
      labels: { confirm: t("Delete"), cancel: t("Cancel") },
      confirmProps: { color: "red" },
      onConfirm: () =>
        deleteMutation.mutate({ announcementId: announcement.id }),
    });

  const tableActions = {
    onEdit: hasFeature ? openForm : undefined,
    onArchive: (announcement: IAnnouncement) =>
      archiveMutation.mutate({ announcementId: announcement.id }),
    onUnarchive: hasFeature
      ? (announcement: IAnnouncement) =>
          unarchiveMutation.mutate({ announcementId: announcement.id })
      : undefined,
    onDelete: confirmDelete,
  };

  return (
    <>
      <DocumentTitle title={t("Announcements")} />

      <SettingsTitle title={t("Announcements")} />

      <Group justify="space-between" align="center" wrap="nowrap" mb="md">
        <Text size="sm" c="dimmed">
          {t(
            "Show a banner at the top of every page. Only one can show at a time.",
          )}
        </Text>
        <Button onClick={() => openForm(null)} style={{ flexShrink: 0 }}>
          {t("New announcement")}
        </Button>
      </Group>

      <Group gap="sm" align="flex-start">
        <SearchInput onSearch={handleSearch} />
        <AnnouncementArchiveFilter
          archived={archived}
          onChange={(next) => {
            setArchived(next);
            resetPagination();
          }}
        />
      </Group>

      {query.isError && !query.data && !isNotFound(query.error) ? (
        <Alert icon={<IconAlertCircle size={16} />} color="red">
          {getApiErrorMessage(query.error, t("Failed to load announcements"))}
        </Alert>
      ) : (
        <>
          <AnnouncementTable
            announcements={query.data?.items ?? []}
            isLoading={query.isLoading || capabilities === null}
            emptyMessage={
              search
                ? t("No results found...")
                : archived
                  ? t("No archived announcements")
                  : t("No active announcements")
            }
            {...tableActions}
          />

          <Space h="md" />

          {query.data?.items.length > 0 && (
            <Paginate
              hasPrevPage={query.data.meta.hasPrevPage}
              hasNextPage={query.data.meta.hasNextPage}
              onNext={() => goNext(query.data.meta.nextCursor)}
              onPrev={goPrev}
            />
          )}
        </>
      )}

      <AnnouncementFormModal
        opened={formOpened}
        onClose={() => setFormOpened(false)}
        announcement={selected}
      />
    </>
  );
}
