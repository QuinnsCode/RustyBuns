import { setDefaultTimeout } from "bun:test";
import { rideParks } from "./ride.ts";

setDefaultTimeout(60000);
rideParks(2);
