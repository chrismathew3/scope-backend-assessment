import NextAuth from "next-auth";
import { authOptions } from "~/server/auth";

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const handler = NextAuth(authOptions);

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const GET = handler;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const POST = handler;

