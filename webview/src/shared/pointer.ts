// True when the pointer itself moved. Content drawn or scrolled under a still pointer also fires
// mouse events, with no movement, and those must not take the keyboard's place in a list.
export function pointerMoved(event: { movementX: number; movementY: number }): boolean {
  return event.movementX !== 0 || event.movementY !== 0
}
