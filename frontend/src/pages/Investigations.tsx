import { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  FolderOpen,
  Plus,
  Trash2,
  Archive,
  Edit2,
  ChevronRight,
  Search,
  LayoutGrid,
  LayoutList,
  Filter,
  X,
  CheckSquare,
  Square,
  Database,
  MessageSquare,
  Calendar,
  ArchiveRestore,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ScrollToTop } from "@/components/ui/ScrollToTop";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import {
  listInvestigations,
  createInvestigation,
  deleteInvestigation,
  updateInvestigation,
} from "@/services/api";
import { useInvestigationStore } from "@/stores/investigationStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { Investigation } from "@/types/investigation";

type ViewMode = "cards" | "list";
type StatusFilter = "all" | "active" | "archived";

export function Investigations() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { currentInvestigation, setCurrentInvestigation, setInvestigations, clearInvestigation } = useInvestigationStore();
  const { clearSession } = useSessionStore();
  const { addToast } = useToast();
  const [showCreateModal, setShowCreateModal] = useState(searchParams.get("create") === "true");
  const [editingInvestigation, setEditingInvestigation] = useState<Investigation | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; investigation: Investigation | null }>({
    isOpen: false,
    investigation: null,
  });
  
  // New state for Phase 5 improvements
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["investigations"],
    queryFn: listInvestigations,
  });

  useEffect(() => {
    if (data?.investigations) {
      setInvestigations(data.investigations);
    }
  }, [data, setInvestigations]);

  const createMutation = useMutation({
    mutationFn: createInvestigation,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["investigations"] });
      setShowCreateModal(false);
      addToast({
        type: "success",
        title: "Investigation Created",
        message: `"${data.name}" has been created.`,
      });
    },
    onError: (error) => {
      addToast({
        type: "error",
        title: "Failed to Create",
        message: (error as Error).message,
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteInvestigation,
    onSuccess: (_data, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ["investigations"] });
      // If deleted investigation was the current one, clear all state
      if (currentInvestigation?.id === deletedId) {
        clearInvestigation();
        clearSession();
      }
      addToast({
        type: "success",
        title: "Investigation Deleted",
        message: "The investigation and all its data have been removed.",
      });
    },
    onError: (error) => {
      addToast({
        type: "error",
        title: "Failed to Delete",
        message: (error as Error).message,
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof updateInvestigation>[1] }) =>
      updateInvestigation(id, data),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["investigations"] });
      setEditingInvestigation(null);
      const action = variables.data.status === "archived" ? "archived" : "updated";
      addToast({
        type: "success",
        title: `Investigation ${action.charAt(0).toUpperCase() + action.slice(1)}`,
        message: `The investigation has been ${action}.`,
      });
    },
    onError: (error) => {
      addToast({
        type: "error",
        title: "Failed to Update",
        message: (error as Error).message,
      });
    },
  });

  const handleSelectInvestigation = (investigation: Investigation) => {
    setCurrentInvestigation(investigation);
    navigate("/");
  };

  const handleArchive = (e: React.MouseEvent, investigation: Investigation) => {
    e.stopPropagation();
    updateMutation.mutate({ id: investigation.id, data: { status: "archived" } });
    // If archived investigation was the current one, clear state
    if (currentInvestigation?.id === investigation.id) {
      clearInvestigation();
      clearSession();
    }
  };

  const handleDelete = (e: React.MouseEvent, investigation: Investigation) => {
    e.stopPropagation();
    setDeleteConfirm({ isOpen: true, investigation });
  };

  const confirmDelete = () => {
    if (deleteConfirm.investigation) {
      deleteMutation.mutate(deleteConfirm.investigation.id);
      setDeleteConfirm({ isOpen: false, investigation: null });
    }
  };

  // Batch actions
  const handleToggleSelect = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    const allIds = filteredInvestigations.map(inv => inv.id);
    if (selectedIds.size === allIds.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allIds));
    }
  };

  const handleBatchArchive = () => {
    selectedIds.forEach(id => {
      updateMutation.mutate({ id, data: { status: "archived" } });
    });
    setSelectedIds(new Set());
  };

  const handleBatchUnarchive = () => {
    selectedIds.forEach(id => {
      updateMutation.mutate({ id, data: { status: "active" } });
    });
    setSelectedIds(new Set());
  };

  const handleBatchDelete = () => {
    setShowBatchDeleteConfirm(true);
  };

  const confirmBatchDelete = () => {
    selectedIds.forEach(id => {
      deleteMutation.mutate(id);
    });
    setSelectedIds(new Set());
    setShowBatchDeleteConfirm(false);
  };

  // Filter investigations
  const allInvestigations = data?.investigations || [];
  const filteredInvestigations = useMemo(() => {
    return allInvestigations.filter(inv => {
      // Status filter
      if (statusFilter !== "all" && inv.status !== statusFilter) {
        return false;
      }
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          inv.name.toLowerCase().includes(query) ||
          (inv.description?.toLowerCase().includes(query)) ||
          (inv.case_number?.toLowerCase().includes(query))
        );
      }
      return true;
    });
  }, [allInvestigations, statusFilter, searchQuery]);

  // Stats
  const stats = useMemo(() => ({
    total: allInvestigations.length,
    active: allInvestigations.filter(inv => inv.status === "active").length,
    archived: allInvestigations.filter(inv => inv.status === "archived").length,
  }), [allInvestigations]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-brand-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent>
          <p className="text-error">Failed to load investigations</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="h-full flex flex-col gap-3 p-4">
      {/* Compact Header with Filters */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-brand-primary/10 rounded-lg flex items-center justify-center">
            <FolderOpen className="w-4 h-4 text-brand-primary" />
          </div>
          <div>
            <h1 className="text-lg font-heading font-semibold">Investigations</h1>
            <p className="text-xs text-text-muted">
              {stats.total} total · {stats.active} active · {stats.archived} archived
            </p>
          </div>
        </div>
        
        {/* Inline Filters */}
        <div className="flex items-center gap-2 flex-wrap flex-1 justify-end">
          {/* Search */}
          <div className="relative flex-1 min-w-[180px] max-w-[280px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <Input
              type="text"
              placeholder="Search investigations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-7 h-8 text-sm"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-text-primary rounded"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-0.5 p-0.5 bg-bg-elevated rounded-lg">
            {(["all", "active", "archived"] as StatusFilter[]).map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                  statusFilter === status
                    ? "bg-bg-surface text-text-primary shadow-sm"
                    : "text-text-muted hover:text-text-secondary"
                }`}
              >
                {status.charAt(0).toUpperCase() + status.slice(1)}
                {status === "active" && stats.active > 0 && (
                  <span className="ml-1 px-1 py-0.5 bg-brand-primary/20 text-brand-primary rounded-full text-[10px]">
                    {stats.active}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* View Toggle */}
          <div className="flex items-center gap-0.5 p-0.5 bg-bg-elevated rounded-lg">
            <button
              onClick={() => setViewMode("cards")}
              className={`p-1.5 rounded transition-colors ${
                viewMode === "cards"
                  ? "bg-bg-surface text-text-primary shadow-sm"
                  : "text-text-muted hover:text-text-secondary"
              }`}
              title="Card view"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`p-1.5 rounded transition-colors ${
                viewMode === "list"
                  ? "bg-bg-surface text-text-primary shadow-sm"
                  : "text-text-muted hover:text-text-secondary"
              }`}
              title="List view"
            >
              <LayoutList className="w-3.5 h-3.5" />
            </button>
          </div>

          <Button size="sm" className="h-8 text-xs px-3" onClick={() => setShowCreateModal(true)}>
            <Plus className="w-3.5 h-3.5 mr-1" />
            New
          </Button>
        </div>
      </div>

      {/* Batch Actions Bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-3 py-2 bg-bg-surface border border-border-subtle rounded-lg">
          <span className="text-sm text-text-secondary">
            {selectedIds.size} selected
          </span>
          <div className="flex items-center gap-2">
            {statusFilter !== "archived" && (
              <Button size="sm" variant="secondary" onClick={handleBatchArchive}>
                <Archive className="w-3.5 h-3.5 mr-1.5" />
                Archive
              </Button>
            )}
            {statusFilter === "archived" && (
              <Button size="sm" variant="secondary" onClick={handleBatchUnarchive}>
                <ArchiveRestore className="w-3.5 h-3.5 mr-1.5" />
                Restore
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={handleBatchDelete}
              className="text-red-400 hover:text-red-500 hover:bg-red-500/10"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                Delete
              </Button>
            </div>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="ml-auto text-xs text-text-muted hover:text-text-primary"
            >
              Clear selection
            </button>
          </div>
        )}

      {/* Investigations List */}
      {filteredInvestigations.length === 0 ? (
        <div className="bg-bg-surface border border-border-subtle rounded-xl p-12 text-center">
          <div className="w-16 h-16 mx-auto bg-brand-primary/10 rounded-2xl flex items-center justify-center mb-4">
            <FolderOpen className="w-8 h-8 text-brand-primary" />
          </div>
          {allInvestigations.length === 0 ? (
            <>
              <h3 className="text-lg font-medium mb-2">No investigations yet</h3>
              <p className="text-text-muted mb-6 max-w-sm mx-auto">
                Create an investigation to organize your forensic analysis sessions and upload UAC archives.
              </p>
              <Button onClick={() => setShowCreateModal(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Create your first investigation
              </Button>
            </>
          ) : (
            <>
              <h3 className="text-lg font-medium mb-2">No results found</h3>
              <p className="text-text-muted mb-4 max-w-sm mx-auto">
                Try adjusting your search or filter criteria.
              </p>
              <Button variant="secondary" onClick={() => { setSearchQuery(""); setStatusFilter("all"); }}>
                <X className="w-4 h-4 mr-2" />
                Clear filters
              </Button>
            </>
          )}
        </div>
      ) : viewMode === "list" ? (
        /* List View */
        <div className="bg-bg-surface border border-border-subtle rounded-xl overflow-hidden">
          {/* Table Header */}
          <div className="grid grid-cols-[auto_1fr_100px_100px_80px_140px_auto] gap-4 px-4 py-3 border-b border-border-subtle text-xs font-medium text-text-muted uppercase">
            <button onClick={handleSelectAll} className="p-1">
              {selectedIds.size === filteredInvestigations.length ? (
                <CheckSquare className="w-4 h-4 text-brand-primary" />
              ) : (
                <Square className="w-4 h-4" />
              )}
            </button>
            <span>Name</span>
            <span>Status</span>
            <span>Sessions</span>
            <span>Queries</span>
            <span>Updated</span>
            <span>Actions</span>
          </div>
          
          {/* Table Rows */}
          {filteredInvestigations.map((investigation) => {
            const isSelected = selectedIds.has(investigation.id);
            const isCurrent = currentInvestigation?.id === investigation.id;
            
            return (
              <div
                key={investigation.id}
                className={`grid grid-cols-[auto_1fr_100px_100px_80px_140px_auto] gap-4 px-4 py-3 items-center border-b border-border-subtle last:border-b-0 cursor-pointer transition-colors hover:bg-bg-hover ${
                  isSelected ? "bg-brand-primary/5" : ""
                } ${isCurrent ? "bg-brand-primary/10" : ""}`}
                onClick={() => handleSelectInvestigation(investigation)}
              >
                <button onClick={(e) => handleToggleSelect(investigation.id, e)} className="p-1">
                  {isSelected ? (
                    <CheckSquare className="w-4 h-4 text-brand-primary" />
                  ) : (
                    <Square className="w-4 h-4 text-text-muted" />
                  )}
                </button>
                
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-text-primary truncate">{investigation.name}</span>
                    {investigation.case_number && (
                      <span className="text-xs px-1.5 py-0.5 bg-slate-500/10 text-slate-400 rounded font-mono">
                        {investigation.case_number}
                      </span>
                    )}
                    {isCurrent && (
                      <span className="text-xs px-1.5 py-0.5 bg-brand-primary/20 text-brand-primary rounded">
                        Active
                      </span>
                    )}
                  </div>
                  {investigation.description && (
                    <p className="text-xs text-text-muted truncate">{investigation.description}</p>
                  )}
                </div>
                
                <span className={`text-xs px-2 py-1 rounded-full ${
                  investigation.status === "active" 
                    ? "bg-green-500/10 text-green-400" 
                    : "bg-slate-500/10 text-slate-400"
                }`}>
                  {investigation.status}
                </span>
                
                <span className="text-sm text-text-secondary flex items-center gap-1">
                  <Database className="w-3.5 h-3.5" />
                  {investigation.session_count}
                </span>
                
                <span className="text-sm text-text-secondary flex items-center gap-1">
                  <MessageSquare className="w-3.5 h-3.5" />
                  {investigation.query_count}
                </span>
                
                <span className="text-xs text-text-muted flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />
                  {new Date(investigation.updated_at).toLocaleDateString()}
                </span>
                
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="sm" onClick={() => setEditingInvestigation(investigation)} title="Edit">
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  {investigation.status === "active" ? (
                    <Button variant="ghost" size="sm" onClick={(e) => handleArchive(e, investigation)} title="Archive">
                      <Archive className="w-4 h-4" />
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        updateMutation.mutate({ id: investigation.id, data: { status: "active" } });
                      }}
                      title="Restore"
                    >
                      <ArchiveRestore className="w-4 h-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => handleDelete(e, investigation)}
                    title="Delete"
                    className="text-red-400 hover:text-red-500 hover:bg-red-500/10"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Card View */
        <div className="grid gap-3">
          {filteredInvestigations.map((investigation) => {
            const isSelected = selectedIds.has(investigation.id);
            const isCurrent = currentInvestigation?.id === investigation.id;
            
            return (
              <div
                key={investigation.id}
                className={`group bg-bg-surface border rounded-xl p-4 cursor-pointer transition-all hover:border-brand-primary ${
                  isCurrent ? 'border-brand-primary ring-1 ring-brand-primary/20' : 'border-border-subtle'
                } ${isSelected ? 'ring-2 ring-brand-primary/50' : ''}`}
                onClick={() => handleSelectInvestigation(investigation)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4 min-w-0">
                    <button
                      onClick={(e) => handleToggleSelect(investigation.id, e)}
                      className="p-1 -ml-1"
                    >
                      {isSelected ? (
                        <CheckSquare className="w-5 h-5 text-brand-primary" />
                      ) : (
                        <Square className="w-5 h-5 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </button>
                    <div className={`p-2.5 rounded-lg ${isCurrent ? 'bg-brand-primary/20' : 'bg-brand-primary/10'}`}>
                      <FolderOpen className="w-5 h-5 text-brand-primary" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-medium text-text-primary truncate">
                          {investigation.name}
                        </h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          investigation.status === "active" 
                            ? "bg-green-500/10 text-green-400" 
                            : "bg-slate-500/10 text-slate-400"
                        }`}>
                          {investigation.status}
                        </span>
                        {isCurrent && (
                          <span className="text-xs px-2 py-0.5 bg-brand-primary/20 text-brand-primary rounded-full whitespace-nowrap">
                            Current
                          </span>
                        )}
                        {investigation.case_number && (
                          <span className="text-xs px-2 py-0.5 bg-slate-500/10 text-slate-400 rounded-full font-mono whitespace-nowrap">
                            {investigation.case_number}
                          </span>
                        )}
                      </div>
                      {investigation.description && (
                        <p className="text-sm text-text-muted mt-0.5 truncate">
                          {investigation.description}
                        </p>
                      )}
                      <div className="flex items-center gap-4 mt-2 text-xs text-text-muted">
                        <span className="flex items-center gap-1">
                          <Database className="w-3.5 h-3.5" />
                          {investigation.session_count} sessions
                        </span>
                        <span className="flex items-center gap-1">
                          <MessageSquare className="w-3.5 h-3.5" />
                          {investigation.query_count} queries
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5" />
                          {new Date(investigation.updated_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingInvestigation(investigation);
                      }}
                      title="Edit"
                    >
                      <Edit2 className="w-4 h-4" />
                    </Button>
                    {investigation.status === "active" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => handleArchive(e, investigation)}
                        title="Archive"
                      >
                        <Archive className="w-4 h-4" />
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          updateMutation.mutate({ id: investigation.id, data: { status: "active" } });
                        }}
                        title="Restore"
                      >
                        <ArchiveRestore className="w-4 h-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => handleDelete(e, investigation)}
                      title="Delete"
                      className="text-red-400 hover:text-red-500 hover:bg-red-500/10"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                    <ChevronRight className="w-5 h-5 text-text-muted ml-2" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <CreateInvestigationModal
          onClose={() => setShowCreateModal(false)}
          onSubmit={(data) => createMutation.mutate(data)}
          isLoading={createMutation.isPending}
        />
      )}

      {/* Edit Modal */}
      {editingInvestigation && (
        <EditInvestigationModal
          investigation={editingInvestigation}
          onClose={() => setEditingInvestigation(null)}
          onSubmit={(data) =>
            updateMutation.mutate({ id: editingInvestigation.id, data })
          }
          isLoading={updateMutation.isPending}
        />
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        onClose={() => setDeleteConfirm({ isOpen: false, investigation: null })}
        onConfirm={confirmDelete}
        title="Delete Investigation"
        message={
          <>
            Are you sure you want to delete <strong>"{deleteConfirm.investigation?.name}"</strong>?
            <br /><br />
            This will permanently remove all sessions, artifacts, and query history associated with this investigation.
          </>
        }
        confirmLabel="Delete"
        variant="danger"
        isLoading={deleteMutation.isPending}
      />

      {/* Batch Delete Confirmation */}
      <ConfirmDialog
        isOpen={showBatchDeleteConfirm}
        onClose={() => setShowBatchDeleteConfirm(false)}
        onConfirm={confirmBatchDelete}
        title="Delete Multiple Investigations"
        message={
          <>
            Are you sure you want to delete <strong>{selectedIds.size} investigations</strong>?
            <br /><br />
            This will permanently remove all sessions, artifacts, and query history associated with these investigations.
          </>
        }
        confirmLabel={`Delete ${selectedIds.size} Investigations`}
        variant="danger"
        isLoading={deleteMutation.isPending}
      />

      <ScrollToTop />
    </div>
  );
}

function CreateInvestigationModal({
  onClose,
  onSubmit,
  isLoading,
}: {
  onClose: () => void;
  onSubmit: (data: { name: string; description?: string; case_number?: string }) => void;
  isLoading: boolean;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [caseNumber, setCaseNumber] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name,
      description: description || undefined,
      case_number: caseNumber || undefined,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>New Investigation</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 bg-bg-default border border-border-default rounded focus:outline-none focus:border-brand-primary"
                placeholder="Investigation name"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                Case Number
              </label>
              <input
                type="text"
                value={caseNumber}
                onChange={(e) => setCaseNumber(e.target.value)}
                className="w-full px-3 py-2 bg-bg-default border border-border-default rounded focus:outline-none focus:border-brand-primary"
                placeholder="e.g., CASE-2026-001"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3 py-2 bg-bg-default border border-border-default rounded focus:outline-none focus:border-brand-primary"
                placeholder="Brief description of the investigation"
                rows={3}
              />
            </div>
            <div className="flex gap-3 justify-end">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={!name || isLoading}>
                {isLoading ? "Creating..." : "Create"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function EditInvestigationModal({
  investigation,
  onClose,
  onSubmit,
  isLoading,
}: {
  investigation: Investigation;
  onClose: () => void;
  onSubmit: (data: { name?: string; description?: string; case_number?: string }) => void;
  isLoading: boolean;
}) {
  const [name, setName] = useState(investigation.name);
  const [description, setDescription] = useState(investigation.description || "");
  const [caseNumber, setCaseNumber] = useState(investigation.case_number || "");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name,
      description: description || undefined,
      case_number: caseNumber || undefined,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Edit Investigation</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 bg-bg-default border border-border-default rounded focus:outline-none focus:border-brand-primary"
                placeholder="Investigation name"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                Case Number
              </label>
              <input
                type="text"
                value={caseNumber}
                onChange={(e) => setCaseNumber(e.target.value)}
                className="w-full px-3 py-2 bg-bg-default border border-border-default rounded focus:outline-none focus:border-brand-primary"
                placeholder="e.g., CASE-2026-001"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3 py-2 bg-bg-default border border-border-default rounded focus:outline-none focus:border-brand-primary"
                placeholder="Brief description of the investigation"
                rows={3}
              />
            </div>
            <div className="flex gap-3 justify-end">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={!name || isLoading}>
                {isLoading ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
