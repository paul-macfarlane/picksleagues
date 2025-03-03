import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { getDBUserById } from "@/db/users";
import { NotFoundError } from "@/models/errors";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Missing or invalid authorization token" },
        { status: 401 },
      );
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET!,
    ) as jwt.JwtPayload;
    if (!decoded || !decoded.sub) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const userId = decoded.sub;
    const user = await getDBUserById(userId);
    if (!user) {
      throw new NotFoundError("User not found");
    }

    return NextResponse.json({ user });
  } catch (error) {
    console.error("Error retrieving user information:", error);

    if (error instanceof jwt.JsonWebTokenError) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 },
      );
    }

    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    return NextResponse.json(
      { error: "Failed to retrieve user information" },
      { status: 500 },
    );
  }
}
