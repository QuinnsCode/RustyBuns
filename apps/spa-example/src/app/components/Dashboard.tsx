import { visits } from "@/db";
export async function Dashboard() { return <div>visits: {await visits()}</div>; }
