// Public API of the schedule feature — timetable & placement (M5, M7).
export { Timetable, type TimetableProps } from './Timetable';
export { TimetableDragRoot, type TimetableDragRootProps } from './drag/TimetableDragRoot';
export { dragSourceProps, useBankDropZone } from './drag/dragContext';
export {
  activityEditMutationKey,
  usePlacementActions,
  useQueuedActivityUpdate,
  type PlacementActions,
  type QueuedActivityUpdate,
  type QueuedActivityUpdateCallbacks,
} from './hooks';
export { PlannerLayout, type PlannerLayoutProps } from './phone/PlannerLayout';
export { findPlacedActivityButton, PLACED_ACTIVITY_ATTR } from './placedActivity';
