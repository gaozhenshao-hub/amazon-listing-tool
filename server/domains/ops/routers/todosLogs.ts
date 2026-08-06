import { protectedProcedure } from "../workspaceProcedure";
import { opsWorkService as service } from "../workManagement/service";
import {
  createLogInput,
  createTodoInput,
  idInput,
  productIdInput,
  updateTodoInput,
} from "../workManagement/schema";

export const opsTodoLogProcedures = {
  getTodos: protectedProcedure.input(productIdInput).query(({ input }) => service.listTodos(input.productId)),
  createTodo: protectedProcedure.input(createTodoInput).mutation(({ ctx, input }) => service.createTodo(ctx.user.id, input)),
  updateTodo: protectedProcedure.input(updateTodoInput).mutation(({ input }) => service.updateTodo(input)),
  deleteTodo: protectedProcedure.input(idInput).mutation(({ input }) => service.deleteTodo(input.id)),
  getLogs: protectedProcedure.input(productIdInput).query(({ input }) => service.listLogs(input.productId)),
  createLog: protectedProcedure.input(createLogInput).mutation(({ ctx, input }) => service.createLog(ctx.user, input)),
  deleteLog: protectedProcedure.input(idInput).mutation(({ input }) => service.deleteLog(input.id)),
};
