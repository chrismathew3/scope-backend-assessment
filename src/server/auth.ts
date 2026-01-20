import { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "~/server/db";
import { isAllowedEmail } from "~/lib/email-validation";

/**
 * NextAuth configuration options
 */
export const authOptions: NextAuthOptions = {
  // Using JWT strategy - no adapter needed
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
    signOut: "/login",
    error: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        try {
          if (!credentials?.email || !credentials?.password) {
            throw new Error("Email and password required");
          }

          // Check if email is allowed
          if (!isAllowedEmail(credentials.email)) {
            throw new Error(
              "Only daniel.bogart17@gmail.com and @scopelabs.com emails are allowed",
            );
          }

          // Find user
          const user = await db.user.findUnique({
            where: { email: credentials.email },
          });

          if (!user) {
            throw new Error("Invalid email or password. Please sign up if you don't have an account.");
          }

          // Verify password
          const isPasswordValid = await bcrypt.compare(
            credentials.password,
            user.password,
          );

          if (!isPasswordValid) {
            throw new Error("Invalid email or password");
          }

          return {
            id: user.id,
            email: user.email,
            name: user.name,
          };
        } catch (error) {
          // If it's already our error, rethrow it
          if (error instanceof Error && error.message.includes("Invalid email")) {
            throw error;
          }
          if (error instanceof Error && error.message.includes("Email and password")) {
            throw error;
          }
          if (error instanceof Error && error.message.includes("Only daniel.bogart17@gmail.com")) {
            throw error;
          }
          // For any database or unexpected errors, show a generic message
          console.error("Authentication error:", error);
          throw new Error("Unable to sign in. Please try again or sign up if you don't have an account.");
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.email = user.email;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = String(token.id);
        session.user.email = String(token.email);
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};

