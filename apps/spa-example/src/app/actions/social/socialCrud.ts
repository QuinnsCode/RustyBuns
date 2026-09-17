"use server";
import { requestInfo } from "rwsdk/worker";
import { visits } from "@/db";
export async function listFriends() { return { user: requestInfo.ctx.user.id, friends: [] as string[], visits: await visits() }; }
export const addFriend = async (id: string) => ({ ok: true, id });
