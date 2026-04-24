"use client";

import { Role } from "@prisma/client";
import { changeUserRole } from "@/_actions/admin";
import { toast } from "sonner";
import { useState } from "react";

export function UserRoleSelect({ userId, currentRole, disabled }: { userId: string, currentRole: Role, disabled?: boolean }) {
  const [loading, setLoading] = useState(false);

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newRole = e.target.value as Role;
    if (newRole === currentRole) return;

    if (!confirm(`Change role to ${newRole}?`)) {
      e.target.value = currentRole;
      return;
    }

    setLoading(true);
    try {
      await changeUserRole(userId, newRole);
      toast.success("Role updated successfully");
    } catch (err: any) {
      toast.error(err.message || "Failed to change role");
      e.target.value = currentRole;
    } finally {
      setLoading(false);
    }
  };

  return (
    <select
      className="flex h-9 w-[130px] items-center justify-between rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
      defaultValue={currentRole}
      onChange={handleChange}
      disabled={disabled || loading}
    >
      {Object.keys(Role).map(r => (
        <option key={r} value={r}>{r}</option>
      ))}
    </select>
  );
}
