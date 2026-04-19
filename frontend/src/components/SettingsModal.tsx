import { Modal } from "./Modal";
import { SettingsPanel } from "./SettingsPanel";

export function SettingsModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose}>
      <SettingsPanel onClose={onClose} />
    </Modal>
  );
}
