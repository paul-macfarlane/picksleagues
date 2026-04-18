import { redirect } from "next/navigation";

export default function HomeRedirect(): never {
  redirect("/leagues");
}
