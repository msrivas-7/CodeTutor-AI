import { Modal } from "./Modal";
import { SettingsPanel } from "./SettingsPanel";

export function SettingsModal({
  onClose,
  onShareChanged,
}: {
  onClose: () => void;
  onShareChanged?: (change: {
    courseId: string;
    lessonId: string;
    shared: boolean;
  }) => void;
}) {
  return (
    <Modal
      onClose={onClose}
      panelClassName="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-panel p-5 shadow-xl"
    >
      <SettingsPanel onClose={onClose} onShareChanged={onShareChanged} />
    </Modal>
  );
}
