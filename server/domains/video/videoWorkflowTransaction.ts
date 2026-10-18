import { AsyncLocalStorage } from "node:async_hooks";
import type { AppDb } from "../../repositories/dbClient";

/** Request-local transaction propagation only; never a permission grant. */
type VideoTransaction = Parameters<Parameters<AppDb["transaction"]>[0]>[0];
const transactions = new AsyncLocalStorage<VideoTransaction>();
export const currentVideoWorkflowTransaction = () => transactions.getStore();
export const withVideoWorkflowTransaction = <T>(tx: VideoTransaction, body: () => Promise<T>) => transactions.run(tx, body);
