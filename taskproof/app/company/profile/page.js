import { getCurrentUser } from "@/lib/auth";
import ProfileForm from "./ProfileForm";

export default async function CompanyProfilePage() {
  const user = await getCurrentUser();
  return (
    <div className="max-w-xl flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Company profile</h1>
      <ProfileForm company={user.company} />
    </div>
  );
}
