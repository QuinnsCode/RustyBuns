"use client";
import { useEffect, useState } from "react";
import { listFriends } from "@/app/actions/social/socialCrud";
export function FriendsPanel() {
  const [s, set] = useState<any>(null);
  useEffect(() => { listFriends().then(set); }, []);
  return <pre>{JSON.stringify(s)}</pre>;
}
