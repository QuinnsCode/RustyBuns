// Backdrop clicks close a dialog only when the press and the release both land on the
// backdrop itself, so a click that starts inside the dialog (and re-renders it) never closes it.
export function scrimProps(onClose: () => void) {
  let downHere = false;
  return {
    onMouseDown: (e: React.MouseEvent) => { downHere = e.target === e.currentTarget; },
    onClick: (e: React.MouseEvent) => { if (downHere && e.target === e.currentTarget) onClose(); downHere = false; },
  };
}
