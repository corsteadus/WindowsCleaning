import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { UserCircle, Plus, Phone, Mail, MoreVertical, Pencil, Trash2, PowerOff, Power } from "lucide-react";
import {
  useListCrews,
  useCreateCrew,
  useUpdateCrew,
  useDeleteCrew,
  useListActiveTeamUsers,
  getListCrewsQueryKey,
  getListJobsQueryKey,
  type Crew,
  type CreateCrewBody,
  type UpdateCrewBody
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useAuth } from "@workspace/replit-auth-web";
import { authScopedQueryKey } from "@/lib/auth-scope";
import { filterSelectableCrewTechnicians } from "@/lib/crew-technician-options";

const crewSchema = z.object({
  name: z.string().trim().min(1, "Crew name is required"),
  leadUserId: z.string().min(1, "Lead technician is required"),
  memberUserIds: z.array(z.string()).default([]),
});

export default function Crews() {
  const { user } = useAuth();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editCrew, setEditCrew] = useState<Crew | null>(null);
  const [deleteCrew, setDeleteCrew] = useState<Crew | null>(null);

  const { data: crewsData, isLoading } = useListCrews({
    query: { queryKey: authScopedQueryKey(user, getListCrewsQueryKey()) }
  });
  const crews = crewsData || [];

  const { data: teamUsersData } = useListActiveTeamUsers({
    query: { queryKey: authScopedQueryKey(user, ["/api/team-users/active"]) }
  });
  const teamUsers = filterSelectableCrewTechnicians(teamUsersData || []);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createMutation = useCreateCrew({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getListCrewsQueryKey()) });
        queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getListJobsQueryKey()) });
        setIsCreateOpen(false);
        toast({ title: "Crew created successfully" });
        form.reset();
      },
      onError: (err: any) => {
        toast({ title: "Failed to create crew", description: err?.data?.error || "Unknown error", variant: "destructive" });
      }
    }
  });

  const updateMutation = useUpdateCrew({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getListCrewsQueryKey()) });
        queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getListJobsQueryKey()) });
        setEditCrew(null);
        toast({ title: "Crew updated successfully" });
      },
      onError: (err: any) => {
        toast({ title: "Failed to update crew", description: err?.data?.error || "Unknown error", variant: "destructive" });
      }
    }
  });

  const deleteMutation = useDeleteCrew({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getListCrewsQueryKey()) });
        queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getListJobsQueryKey()) });
        setDeleteCrew(null);
        toast({ title: "Crew deleted successfully" });
      },
      onError: (err: any) => {
        const msg = err?.data?.error || "Failed to delete crew";
        toast({ title: "Cannot delete crew", description: msg, variant: "destructive" });
      }
    }
  });

  const form = useForm<z.infer<typeof crewSchema>>({
    resolver: zodResolver(crewSchema),
    defaultValues: {
      name: "",
      leadUserId: "",
      memberUserIds: [],
    },
  });

  const editForm = useForm<z.infer<typeof crewSchema>>({
    resolver: zodResolver(crewSchema),
    defaultValues: {
      name: "",
      leadUserId: "",
      memberUserIds: [],
    },
  });

  function onSubmit(values: z.infer<typeof crewSchema>) {
    createMutation.mutate({ data: values as CreateCrewBody });
  }

  function onEditSubmit(values: z.infer<typeof crewSchema>) {
    if (!editCrew) return;
    updateMutation.mutate({ id: editCrew.id, data: values as UpdateCrewBody });
  }

  function handleToggleActive(crew: Crew) {
    updateMutation.mutate({
      id: crew.id,
      data: { isActive: !crew.isActive }
    });
  }

  function openEdit(crew: Crew) {
    const members = crew.members || [];
    const lead = members.find(m => m.role === 'lead');
    const memberIds = members.filter(m => m.role === 'member').map(m => m.userId);

    let leadUserId = crew.lead?.userId || lead?.userId || "";

    editForm.reset({
      name: crew.name,
      leadUserId,
      memberUserIds: memberIds,
    });
    setEditCrew(crew);
  }

  return (
    <Layout>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold text-slate-900">Crew Management</h1>
          <p className="text-muted-foreground mt-1">Organize your field teams and technicians.</p>
        </div>

        <Dialog open={isCreateOpen} onOpenChange={(open) => {
          if (!open) form.reset();
          setIsCreateOpen(open);
        }}>
          <DialogTrigger asChild>
            <Button className="rounded-xl shadow-lg shadow-primary/20">
              <Plus className="w-5 h-5 mr-2" />
              Add Crew
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px] rounded-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-display text-2xl">New Crew</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Crew Name</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Alpha Team" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="leadUserId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Lead Technician</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select lead technician..." />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {teamUsers.map(u => (
                            <SelectItem key={u.id} value={u.id}>{u.displayName}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="memberUserIds"
                  render={() => (
                    <FormItem>
                      <FormLabel className="mb-2 block">Crew Members (Optional)</FormLabel>
                      <div className="space-y-2 border border-slate-100 rounded-xl p-3 bg-slate-50/50 max-h-48 overflow-y-auto">
                        {teamUsers.length === 0 ? (
                          <p className="text-sm text-slate-500 italic">No active technicians found</p>
                        ) : teamUsers.map((u) => (
                          <FormField
                            key={u.id}
                            control={form.control}
                            name="memberUserIds"
                            render={({ field }) => {
                              const isLead = form.watch("leadUserId") === u.id;
                              return (
                                <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                                  <FormControl>
                                    <Checkbox
                                      checked={isLead || field.value?.includes(u.id)}
                                      disabled={isLead}
                                      onCheckedChange={(checked) => {
                                        return checked
                                          ? field.onChange([...field.value, u.id])
                                          : field.onChange(
                                              field.value?.filter(
                                                (value) => value !== u.id
                                              )
                                            )
                                      }}
                                    />
                                  </FormControl>
                                  <FormLabel className="font-normal cursor-pointer text-sm">
                                    {u.displayName} {isLead && <span className="text-slate-400 text-xs">(Lead)</span>}
                                  </FormLabel>
                                </FormItem>
                              )
                            }}
                          />
                        ))}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full rounded-xl mt-6" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Creating..." : "Create Crew"}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>

        {/* Edit Dialog */}
        <Dialog open={!!editCrew} onOpenChange={(open) => !open && setEditCrew(null)}>
          <DialogContent className="sm:max-w-[425px] rounded-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-display text-2xl">Edit Crew</DialogTitle>
            </DialogHeader>
            <Form {...editForm}>
              <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4 mt-4">
                <FormField
                  control={editForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Crew Name</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Alpha Team" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="leadUserId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Lead Technician</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select lead technician..." />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {teamUsers.map(u => (
                            <SelectItem key={u.id} value={u.id}>{u.displayName}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={editForm.control}
                  name="memberUserIds"
                  render={() => (
                    <FormItem>
                      <FormLabel className="mb-2 block">Crew Members</FormLabel>
                      <div className="space-y-2 border border-slate-100 rounded-xl p-3 bg-slate-50/50 max-h-48 overflow-y-auto">
                        {teamUsers.length === 0 ? (
                          <p className="text-sm text-slate-500 italic">No active technicians found</p>
                        ) : teamUsers.map((u) => (
                          <FormField
                            key={u.id}
                            control={editForm.control}
                            name="memberUserIds"
                            render={({ field }) => {
                              const isLead = editForm.watch("leadUserId") === u.id;
                              return (
                                <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                                  <FormControl>
                                    <Checkbox
                                      checked={isLead || field.value?.includes(u.id)}
                                      disabled={isLead}
                                      onCheckedChange={(checked) => {
                                        return checked
                                          ? field.onChange([...(field.value || []), u.id])
                                          : field.onChange(
                                              field.value?.filter(
                                                (value) => value !== u.id
                                              )
                                            )
                                      }}
                                    />
                                  </FormControl>
                                  <FormLabel className="font-normal cursor-pointer text-sm">
                                    {u.displayName} {isLead && <span className="text-slate-400 text-xs">(Lead)</span>}
                                  </FormLabel>
                                </FormItem>
                              )
                            }}
                          />
                        ))}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full rounded-xl mt-6" disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>

        {/* Delete Dialog */}
        <Dialog open={!!deleteCrew} onOpenChange={(open) => !open && setDeleteCrew(null)}>
          <DialogContent className="sm:max-w-[425px] rounded-2xl">
            <DialogHeader>
              <DialogTitle className="font-display text-2xl text-red-600">Delete Crew?</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <p className="text-slate-600">
                Are you sure you want to delete <strong>{deleteCrew?.name}</strong>?
              </p>
              <div className="bg-amber-50 text-amber-800 p-3 rounded-lg text-sm border border-amber-200">
                Deletion only succeeds if there are <strong>no current or historical jobs</strong> assigned to this crew. If there are, the server will block it and you should <strong>deactivate</strong> the crew instead.
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteCrew(null)}>Cancel</Button>
              <Button
                variant="destructive"
                onClick={() => deleteCrew && deleteMutation.mutate({ id: deleteCrew.id })}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete Crew"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
           {[1, 2, 3].map(i => <Card key={i} className="h-48 border-none bg-slate-100 animate-pulse rounded-2xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {crews?.map((crew) => {
            const hasNormalizedMembership = crew.lead || (crew.members && crew.members.length > 0);
            return (
              <Card key={crew.id} className={`border-none shadow-sm transition-all bg-white rounded-2xl overflow-hidden group ${!crew.isActive ? 'opacity-75' : ''}`}>
                <div className={`h-2 w-full transition-colors ${crew.isActive ? 'bg-primary/20 group-hover:bg-primary' : 'bg-slate-200'}`} />
                <CardHeader className="pb-4 border-b border-slate-50 relative">

                  <div className="absolute top-4 right-4">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-slate-900 rounded-xl">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="rounded-xl">
                        <DropdownMenuItem onClick={() => openEdit(crew)} className="cursor-pointer">
                          <Pencil className="mr-2 h-4 w-4" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleToggleActive(crew)} className="cursor-pointer">
                          {crew.isActive ? (
                            <><PowerOff className="mr-2 h-4 w-4" /> Deactivate</>
                          ) : (
                            <><Power className="mr-2 h-4 w-4" /> Reactivate</>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => setDeleteCrew(crew)} className="cursor-pointer text-red-600 focus:bg-red-50 focus:text-red-700">
                          <Trash2 className="mr-2 h-4 w-4" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div className="flex flex-col items-start pr-8">
                    <CardTitle className="text-xl font-display font-bold text-slate-900 leading-tight mb-2">{crew.name}</CardTitle>
                    <Badge variant={crew.isActive ? 'default' : 'secondary'} className={crew.isActive ? 'bg-green-100 text-green-800 hover:bg-green-200' : 'bg-slate-100 text-slate-600'}>
                      {crew.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>

                  <div className="mt-4 space-y-2">
                    <p className="text-sm font-medium text-primary flex items-start gap-2">
                      <UserCircle className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>
                        Lead: {crew.lead?.displayName || (hasNormalizedMembership ? "Unassigned" : (crew.legacyDisplay?.leadTechnician ? <span className="italic text-slate-500">{crew.legacyDisplay.leadTechnician} (Legacy)</span> : "Unassigned"))}
                      </span>
                    </p>

                    {crew.members && crew.members.length > 0 && (
                      <p className="text-xs text-slate-500 pl-6">
                        Members: {crew.members.filter(m => m.role !== 'lead').map(m => m.displayName).join(", ") || "None"}
                      </p>
                    )}

                    {!hasNormalizedMembership && crew.legacyDisplay?.members && (
                      <p className="text-xs text-slate-500 pl-6 italic">
                        Members: {crew.legacyDisplay.members} (Legacy)
                      </p>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pt-4 bg-slate-50/50">
                  <div className="space-y-2 text-sm text-slate-600">
                    {crew.phone && (
                      <div className="flex items-center gap-2">
                        <Phone className="w-4 h-4 text-slate-400" /> {crew.phone}
                      </div>
                    )}
                    {crew.email && (
                      <div className="flex items-center gap-2">
                        <Mail className="w-4 h-4 text-slate-400" /> {crew.email}
                      </div>
                    )}
                    {!crew.phone && !crew.email && (
                      <p className="text-slate-400 italic">No contact info provided</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {crews?.length === 0 && (
             <div className="col-span-full py-16 flex flex-col items-center justify-center text-slate-500 bg-white rounded-2xl border border-dashed border-slate-200 shadow-sm">
               <UserCircle className="w-16 h-16 mb-4 text-slate-300" />
               <h3 className="text-xl font-display font-bold text-slate-900 mb-2">No crews found</h3>
               <p>Add your first crew to start assigning jobs.</p>
             </div>
          )}
        </div>
      )}
    </Layout>
  );
}
