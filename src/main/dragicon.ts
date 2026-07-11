// Small base64 PNG (mint 32x32) used as the cursor badge when dragging files
// out of the app. The OS drag API requires a valid, NON-EMPTY icon — on
// Windows webContents.startDrag THROWS on an empty icon and the drag silently
// never starts. This image is verified to decode (isEmpty() === false, 32x32).
export const DRAG_ICON_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAABAAAAAQBPJcTWAAAAL0lEQVR4nO3OIQEAAAgDMBITgMS0gBg3E/Or3rmkEhAQEBAQEBAQEBAQEBAQSAcelOo8pufSdoAAAAAASUVORK5CYII='
