import { useForumController, useForumModel } from './bindings/forum'

export function useMod() {
  const controller = useForumController()
  const model = useForumModel()
  return { ...controller.moderation, busy: () => model.operations.moderating }
}
