import { useTranslation } from "react-i18next";

export function useFeatureUnavailableLabel(): string {
  const { t } = useTranslation();
  return t("This feature is not available on this instance.");
}
