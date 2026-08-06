import { protectedProcedure } from "../workspaceProcedure";
import { opsWorkService as service } from "../workManagement/service";
import {
  createTeamTaskInput,
  moveTeamTaskInput,
  productProfileIdInput,
  taskIdInput,
  updateTeamTaskInput,
} from "../workManagement/schema";

export const opsTeamTaskProcedures = {
  listTeamTasks: protectedProcedure.input(productProfileIdInput).query(({ input }) => service.listTeamTasks(input.productProfileId)),
  createTeamTask: protectedProcedure.input(createTeamTaskInput).mutation(({ ctx, input }) => service.createTeamTask(ctx.user.id, input)),
  updateTeamTask: protectedProcedure.input(updateTeamTaskInput).mutation(({ input }) => service.updateTeamTask(input)),
  deleteTeamTask: protectedProcedure.input(taskIdInput).mutation(({ input }) => service.deleteTeamTask(input.taskId)),
  moveTeamTask: protectedProcedure.input(moveTeamTaskInput).mutation(({ input }) => service.moveTeamTask(input)),
  getTeamTaskStats: protectedProcedure.input(productProfileIdInput).query(({ input }) => service.getTeamTaskStats(input.productProfileId)),
};
