import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownUp,
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  FilePenLine,
  FilePlus2,
  Filter,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Mail,
  MoreHorizontal,
  Pencil,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";

const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:4000")
  .replace(/\/$/, "");
const categories = ["Travel", "Life", "Stories", "Poetry"] as const;
type Category = (typeof categories)[number];
type PostStatus = "draft" | "published";

type MediaReference = { url: string; publicId?: string };
type PostRecord = {
  _id: string;
  title: string;
  slug: string;
  subtitle?: string;
  excerpt?: string;
  category: Category;
  tags: string[];
  status: PostStatus;
  publishedAt: string | null;
  location?: string;
  readingTimeMinutes?: number | null;
  wordCount?: number | null;
  coverImage?: MediaReference | null;
  coverVideo?: MediaReference | null;
  content: string;
  createdAt: string;
  updatedAt: string;
};

type PostForm = {
  title: string;
  slug: string;
  subtitle: string;
  excerpt: string;
  category: Category;
  tags: string;
  status: PostStatus;
  location: string;
  readingTimeMinutes: string;
  wordCount: string;
  coverImage: string;
  content: string;
  coverImagePublicId: string;
  coverVideo: string;
  coverVideoPublicId: string;
};

const emptyForm: PostForm = {
  title: "",
  slug: "",
  subtitle: "",
  excerpt: "",
  category: "Stories",
  tags: "",
  status: "draft",
  location: "",
  readingTimeMinutes: "",
  wordCount: "",
  coverImage: "",
  coverImagePublicId: "",
  coverVideo: "",
  coverVideoPublicId: "",
  content: "",
};

type ApiError = Error & { status?: number };

function isApiError(error: unknown): error is ApiError {
  return error instanceof Error && "status" in error &&
    typeof error.status === "number";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new Error(`Could not reach the API at ${API_URL}. Is the backend running?`);
  }

  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // The API may return a non-JSON error page.
    }
    if (response.status === 401 && path !== "/api/admin/session") {
      window.dispatchEvent(new Event("admin-auth-required"));
    }
    const error = new Error(message) as ApiError;
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

type CloudinarySignature = {
  cloudName: string;
  apiKey: string;
  folder: string;
  timestamp: number;
  signature: string;
};

async function uploadToCloudinary(
  file: File,
  resourceType: "image" | "video",
  slug: string,
): Promise<MediaReference> {
  const expectedMime = resourceType === "image" ? "image/" : "video/";
  if (!file.type.startsWith(expectedMime)) {
    throw new Error(`Choose a ${resourceType} file to upload.`);
  }
  if (file.size > 100 * 1024 * 1024) {
    throw new Error("Files must be smaller than 100 MB.");
  }

  const credentials = await request<CloudinarySignature>(
    "/api/admin/media/signature",
    {
      method: "POST",
      body: JSON.stringify({ slug, resourceType }),
    },
  );
  const body = new FormData();
  body.append("file", file);
  body.append("api_key", credentials.apiKey);
  body.append("timestamp", String(credentials.timestamp));
  body.append("folder", credentials.folder);
  body.append("signature", credentials.signature);

  let response: Response;
  try {
    response = await fetch(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(credentials.cloudName)}/${resourceType}/upload`,
      { method: "POST", body },
    );
  } catch {
    throw new Error("Could not reach Cloudinary. Check your connection and try again.");
  }

  const result = await response.json() as {
    secure_url?: string;
    public_id?: string;
    error?: { message?: string };
  };
  if (!response.ok || !result.secure_url || !result.public_id) {
    throw new Error(result.error?.message || "Cloudinary could not upload this file.");
  }
  return { url: result.secure_url, publicId: result.public_id };
}

function toPostForm(post?: PostRecord): PostForm {
  if (!post) return { ...emptyForm };
  return {
    title: post.title,
    slug: post.slug,
    subtitle: post.subtitle ?? "",
    excerpt: post.excerpt ?? "",
    category: post.category,
    tags: post.tags.join(", "),
    status: post.status,
    location: post.location ?? "",
    readingTimeMinutes: post.readingTimeMinutes?.toString() ?? "",
    wordCount: post.wordCount?.toString() ?? "",
    coverImage: post.coverImage?.url ?? "",
    coverImagePublicId: post.coverImage?.publicId ?? "",
    coverVideo: post.coverVideo?.url ?? "",
    coverVideoPublicId: post.coverVideo?.publicId ?? "",
    content: post.content,
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "Not published";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function PostEditor({
  post,
  onClose,
  onSaved,
}: {
  post: PostRecord | null;
  onClose: () => void;
  onSaved: (post: PostRecord, created: boolean) => void;
}) {
  const [form, setForm] = useState<PostForm>(() => toPostForm(post ?? undefined));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState<"cover" | "video" | "inline" | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const inlineInputRef = useRef<HTMLInputElement>(null);

  function update<K extends keyof PostForm>(key: K, value: PostForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleUpload(
    event: React.ChangeEvent<HTMLInputElement>,
    target: "cover" | "video" | "inline",
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const slug = (form.slug.trim() || slugify(form.title)).toLowerCase();
    if (!slug) {
      setError("Add a post title before uploading media.");
      return;
    }

    setUploading(target);
    setError("");
    try {
      const media = await uploadToCloudinary(
        file,
        target === "video" ? "video" : "image",
        slug,
      );
      if (target === "cover") {
        update("coverImage", media.url);
        update("coverImagePublicId", media.publicId ?? "");
      } else if (target === "video") {
        update("coverVideo", media.url);
        update("coverVideoPublicId", media.publicId ?? "");
      } else {
        const alt = file.name.replace(/[\[\]]/g, "");
        setForm((current) => ({
          ...current,
          content: `${current.content.trimEnd()}${current.content.trim() ? "\n\n" : ""}![${alt}](${media.url})\n`,
        }));
      }
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Could not upload media.",
      );
    } finally {
      setUploading(null);
    }
  }

  async function save(status: PostStatus) {
    if (!form.title.trim()) {
      setError("Give your post a title before saving.");
      return;
    }
    if (
      [form.coverImage, form.coverVideo].some((url) =>
        url.trim().startsWith("/"),
      )
    ) {
      setError("Upload local media to Cloudinary instead of saving a frontend file path.");
      return;
    }
    if (status === "published" && (!form.excerpt.trim() || !form.content.trim())) {
      setError("Published posts need an excerpt and story content.");
      return;
    }
    setSaving(true);
    setError("");

    const payload = {
      title: form.title.trim(),
      slug: (form.slug.trim() || slugify(form.title)).toLowerCase(),
      subtitle: form.subtitle.trim(),
      excerpt: form.excerpt.trim(),
      category: form.category,
      tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      status,
      publishedAt: status === "published"
        ? post?.publishedAt || new Date().toISOString()
        : null,
      location: form.location.trim(),
      readingTimeMinutes: form.readingTimeMinutes
        ? Number(form.readingTimeMinutes)
        : null,
      wordCount: form.wordCount ? Number(form.wordCount) : null,
      coverImage: form.coverImage.trim()
        ? {
            url: form.coverImage.trim(),
            ...(form.coverImagePublicId
              ? { publicId: form.coverImagePublicId }
              : {}),
          }
        : null,
      coverVideo: form.coverVideo.trim()
        ? {
            url: form.coverVideo.trim(),
            ...(form.coverVideoPublicId
              ? { publicId: form.coverVideoPublicId }
              : {}),
          }
        : null,
      content: form.content,
    };

    try {
      const created = !post;
      const saved = await request<PostRecord>(
        created ? "/api/admin/posts" : `/api/admin/posts/${post._id}`,
        {
          method: created ? "POST" : "PUT",
          body: JSON.stringify(payload),
        },
      );
      onSaved(saved, created);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save post.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="editor-scrim" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving && !uploading) onClose();
    }}>
      <section className="editor-panel" role="dialog" aria-modal="true" aria-labelledby="editor-title">
        <header className="editor-header">
          <button className="icon-button" onClick={onClose} aria-label="Close editor">
            <ArrowLeft size={18} />
          </button>
          <div className="editor-heading">
            <span className="eyebrow">{post ? "EDITING POST" : "NEW STORY"}</span>
            <h2 id="editor-title">{post ? "Edit your post" : "Create a post"}</h2>
          </div>
          <span className={`status-pill ${form.status}`}>
            <span className="status-dot" />{form.status}
          </span>
        </header>

        <div className="editor-scroll">
          {error && <div className="error-banner" role="alert">{error}</div>}
          <div className="editor-grid">
            <div className="editor-main">
              <label className="field-label" htmlFor="post-title">Post title</label>
              <input
                id="post-title"
                className="title-input"
                value={form.title}
                onChange={(event) => update("title", event.target.value)}
                placeholder="Give this story a name"
                maxLength={200}
                autoFocus
              />
              <label className="field-label" htmlFor="post-slug">URL slug</label>
              <div className="slug-input">
                <span>/posts/</span>
                <input
                  id="post-slug"
                  value={form.slug}
                  onChange={(event) => update("slug", slugify(event.target.value))}
                  placeholder={slugify(form.title) || "your-post-title"}
                  maxLength={200}
                />
              </div>
              <label className="field-label" htmlFor="post-subtitle">Subtitle <span>OPTIONAL</span></label>
              <input
                id="post-subtitle"
                value={form.subtitle}
                onChange={(event) => update("subtitle", event.target.value)}
                placeholder="A little more about the story"
                maxLength={300}
              />
              <label className="field-label" htmlFor="post-excerpt">Excerpt</label>
              <textarea
                id="post-excerpt"
                className="excerpt-input"
                value={form.excerpt}
                onChange={(event) => update("excerpt", event.target.value)}
                placeholder="A short introduction for the journal archive"
                maxLength={1000}
                rows={3}
              />
              <label className="field-label" htmlFor="post-content">Your story</label>
              <div className="content-tools">
                <span className="content-hint"><Sparkles size={14} /> Markdown is supported</span>
                <button
                  type="button"
                  className="upload-button inline-upload"
                  onClick={() => inlineInputRef.current?.click()}
                  disabled={uploading !== null}
                >
                  {uploading === "inline"
                    ? <LoaderCircle className="spin" size={14} />
                    : <Upload size={14} />}
                  {uploading === "inline" ? "Uploading..." : "Insert image"}
                </button>
                <input
                  ref={inlineInputRef}
                  className="hidden-file-input"
                  type="file"
                  accept="image/*"
                  onChange={(event) => void handleUpload(event, "inline")}
                />
              </div>
              <textarea
                id="post-content"
                className="content-input"
                value={form.content}
                onChange={(event) => update("content", event.target.value)}
                placeholder={"Start writing here...\n\nYou can use Markdown for headings, links, and lists."}
                rows={16}
              />
            </div>

            <aside className="editor-sidebar">
              <div className="editor-card">
                <h3>Post settings</h3>
                <label className="field-label" htmlFor="post-category">Category</label>
                <select
                  id="post-category"
                  value={form.category}
                  onChange={(event) => update("category", event.target.value as Category)}
                >
                  {categories.map((category) => <option key={category}>{category}</option>)}
                </select>
                <label className="field-label" htmlFor="post-tags">Tags <span>COMMA SEPARATED</span></label>
                <input
                  id="post-tags"
                  value={form.tags}
                  onChange={(event) => update("tags", event.target.value)}
                  placeholder="travel, memories"
                />
                <label className="field-label" htmlFor="post-location">Location <span>OPTIONAL</span></label>
                <input
                  id="post-location"
                  value={form.location}
                  onChange={(event) => update("location", event.target.value)}
                  placeholder="Where this took place"
                  maxLength={120}
                />
                <label className="field-label" htmlFor="post-cover">Cover image URL <span>OPTIONAL</span></label>
                <input
                  id="post-cover"
                  type="url"
                  value={form.coverImage}
                  onChange={(event) => {
                    update("coverImage", event.target.value);
                    update("coverImagePublicId", "");
                  }}
                  placeholder="https://..."
                />
                <div className="media-upload-row">
                  {form.coverImage && (
                    <img
                      className="media-preview"
                      src={form.coverImage}
                      alt="Cover preview"
                    />
                  )}
                  <button
                    type="button"
                    className="upload-button"
                    onClick={() => coverInputRef.current?.click()}
                    disabled={uploading !== null}
                  >
                    {uploading === "cover"
                      ? <LoaderCircle className="spin" size={14} />
                      : <Upload size={14} />}
                    {uploading === "cover" ? "Uploading..." : "Upload to Cloudinary"}
                  </button>
                  <input
                    ref={coverInputRef}
                    className="hidden-file-input"
                    type="file"
                    accept="image/*"
                    onChange={(event) => void handleUpload(event, "cover")}
                  />
                </div>
                <label className="field-label" htmlFor="post-cover-video">Cover video URL <span>OPTIONAL</span></label>
                <input
                  id="post-cover-video"
                  type="url"
                  value={form.coverVideo}
                  onChange={(event) => {
                    update("coverVideo", event.target.value);
                    update("coverVideoPublicId", "");
                  }}
                  placeholder="https://..."
                />
                <div className="media-upload-row">
                  <button
                    type="button"
                    className="upload-button"
                    onClick={() => videoInputRef.current?.click()}
                    disabled={uploading !== null}
                  >
                    {uploading === "video"
                      ? <LoaderCircle className="spin" size={14} />
                      : <Upload size={14} />}
                    {uploading === "video" ? "Uploading..." : "Upload video"}
                  </button>
                  <input
                    ref={videoInputRef}
                    className="hidden-file-input"
                    type="file"
                    accept="video/*"
                    onChange={(event) => void handleUpload(event, "video")}
                  />
                </div>
                <div className="number-fields">
                  <div>
                    <label className="field-label" htmlFor="post-reading-time">Read time</label>
                    <input
                      id="post-reading-time"
                      type="number"
                      min="1"
                      value={form.readingTimeMinutes}
                      onChange={(event) => update("readingTimeMinutes", event.target.value)}
                      placeholder="5 min"
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="post-word-count">Word count</label>
                    <input
                      id="post-word-count"
                      type="number"
                      min="0"
                      value={form.wordCount}
                      onChange={(event) => update("wordCount", event.target.value)}
                      placeholder="Optional"
                    />
                  </div>
                </div>
              </div>
              <div className="editor-note">
                <CircleHelp size={16} />
                <p>Drafts are private. Publishing makes this post visible in the journal.</p>
              </div>
            </aside>
          </div>
        </div>
        <footer className="editor-footer">
          <span className="saved-note">
            {post ? `Last edited ${formatDate(post.updatedAt)}` : "Changes are saved to your journal"}
          </span>
          <div className="editor-actions">
            <button className="button button-quiet" onClick={onClose} disabled={saving || uploading !== null}>Cancel</button>
            <button className="button button-secondary" onClick={() => void save("draft")} disabled={saving || uploading !== null}>
              Save draft
            </button>
            <button className="button button-primary" onClick={() => void save("published")} disabled={saving || uploading !== null}>
              {saving ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={15} />}
              {saving ? "Saving" : "Publish"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function AdminLogin({
  initialEmail,
  onAuthenticated,
}: {
  initialEmail: string;
  onAuthenticated: (email: string, posts: PostRecord[]) => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const session = await request<{ email: string }>("/api/admin/session", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      try {
        const posts = await request<PostRecord[]>("/api/admin/posts");
        onAuthenticated(session.email, posts);
      } catch (requestError) {
        if (isApiError(requestError) && requestError.status === 401) {
          setError(
            "The sign-in was accepted, but the browser did not keep the session cookie. Check the API cookie and cross-site settings.",
          );
        } else {
          throw requestError;
        }
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not sign in.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-brand brand-mark">W<span>.</span></div>
        <span className="eyebrow">THE WARRIOR WIZARD GIRL</span>
        <h1>Welcome back.</h1>
        <p>Sign in to manage your journal.</p>
        <form className="login-form" onSubmit={(event) => void submit(event)}>
          <label>
            <span>Email address</span>
            <div className="login-input">
              <Mail size={16} aria-hidden="true" />
              <input
                autoComplete="username"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoFocus
              />
            </div>
          </label>
          <label>
            <span>Password</span>
            <div className="login-input">
              <LockKeyhole size={16} aria-hidden="true" />
              <input
                autoComplete="current-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
          </label>
          {error && <div className="login-error" role="alert">{error}</div>}
          <button className="button button-primary login-submit" disabled={submitting}>
            {submitting && <LoaderCircle className="spin" size={16} />}
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <small>Your sign-in is securely verified by the journal backend.</small>
      </section>
    </main>
  );
}

export default function App() {
  const [posts, setPosts] = useState<PostRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [authStatus, setAuthStatus] = useState<"checking" | "authenticated" | "unauthenticated">("checking");
  const [adminEmail, setAdminEmail] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | PostStatus>("all");
  const [categoryFilter, setCategoryFilter] = useState("All categories");
  const [editorPost, setEditorPost] = useState<PostRecord | null | undefined>(undefined);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  async function loadPosts(showRefresh = false) {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);
    setLoadError("");
    try {
      setPosts(await request<PostRecord[]>("/api/admin/posts"));
      setAuthStatus("authenticated");
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        setAuthStatus("unauthenticated");
        setLoadError("");
      } else {
        setAuthStatus("authenticated");
        setLoadError(error instanceof Error ? error.message : "Could not load posts.");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadPosts();
  }, []);

  useEffect(() => {
    const requireLogin = () => setAuthStatus("unauthenticated");
    window.addEventListener("admin-auth-required", requireLogin);
    return () => window.removeEventListener("admin-auth-required", requireLogin);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const visiblePosts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return posts.filter((post) => {
      const matchesStatus = statusFilter === "all" || post.status === statusFilter;
      const matchesCategory =
        categoryFilter === "All categories" || post.category === categoryFilter;
      const matchesQuery =
        !normalizedQuery ||
        `${post.title} ${post.slug} ${post.excerpt ?? ""} ${post.tags.join(" ")}`
          .toLowerCase()
          .includes(normalizedQuery);
      return matchesStatus && matchesCategory && matchesQuery;
    });
  }, [posts, query, statusFilter, categoryFilter]);

  const publishedCount = posts.filter((post) => post.status === "published").length;
  const draftCount = posts.length - publishedCount;

  async function deletePost(post: PostRecord) {
    if (!window.confirm(`Delete "${post.title}"? This can't be undone.`)) return;
    setDeletingId(post._id);
    try {
      await request<void>(`/api/admin/posts/${post._id}`, { method: "DELETE" });
      setPosts((current) => current.filter((item) => item._id !== post._id));
      setToast("Post deleted");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not delete post.");
    } finally {
      setDeletingId(null);
    }
  }

  function onSaved(saved: PostRecord, created: boolean) {
    setPosts((current) =>
      created
        ? [saved, ...current]
        : current.map((item) => item._id === saved._id ? saved : item),
    );
    setEditorPost(undefined);
    setToast(created ? "Post created" : "Changes saved");
  }

  async function logOut() {
    try {
      const result = await request<{ authDisabled?: boolean }>(
        "/api/admin/session",
        { method: "DELETE" },
      );
      if (result?.authDisabled) {
        setToast("Local development auth bypass is enabled; sign out is unavailable.");
        return;
      }
      setPosts([]);
      setAuthStatus("unauthenticated");
      setToast("Signed out");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not sign out.");
    }
  }

  if (authStatus === "unauthenticated") {
    return (
      <AdminLogin
        initialEmail={adminEmail}
        onAuthenticated={(email, loadedPosts) => {
          setAdminEmail(email);
          setPosts(loadedPosts);
          setAuthStatus("authenticated");
          setLoadError("");
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <aside className="rail">
        <div className="brand-mark">W<span>.</span></div>
        <div className="rail-divider" />
        <button className="rail-button active" title="Posts" aria-label="Posts">
          <BookOpen size={19} />
        </button>
        <button className="rail-button" title="Dashboard" aria-label="Dashboard" disabled>
          <LayoutDashboard size={19} />
        </button>
        <div className="rail-spacer" />
        <button className="rail-button" title="Settings" aria-label="Settings" disabled>
          <Settings2 size={19} />
        </button>
        <div className="avatar">V</div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>THE WARRIOR WIZARD GIRL</span>
            <span className="crumb-slash">/</span>
            <strong>Journal</strong>
          </div>
          <div className="topbar-actions">
            <span className="api-indicator"><span /> API workspace</span>
            {authStatus === "authenticated" && (
              <button className="logout-button" onClick={() => void logOut()} title={`Sign out${adminEmail ? ` ${adminEmail}` : ""}`}>
                <LogOut size={15} /> <span>Sign out</span>
              </button>
            )}
          </div>
        </header>

        <div className="page-content">
          <section className="welcome-row">
            <div>
              <span className="eyebrow">YOUR LITTLE CORNER OF THE INTERNET</span>
              <h1>Stories, gathered.</h1>
              <p className="welcome-copy">A home for every thought, place, and little adventure.</p>
            </div>
            <button className="button button-primary new-post-button" onClick={() => setEditorPost(null)}>
              <FilePlus2 size={17} /> New post
            </button>
          </section>

          <section className="stats-row" aria-label="Post summary">
            <article className="stat-card">
              <div className="stat-icon lavender"><BookOpen size={17} /></div>
              <div><span className="stat-label">ALL STORIES</span><strong>{posts.length}</strong></div>
              <span className="stat-caption">in your journal</span>
            </article>
            <article className="stat-card">
              <div className="stat-icon green"><ArrowUpRight size={17} /></div>
              <div><span className="stat-label">PUBLISHED</span><strong>{publishedCount}</strong></div>
              <span className="stat-caption">out in the world</span>
            </article>
            <article className="stat-card">
              <div className="stat-icon amber"><FilePenLine size={17} /></div>
              <div><span className="stat-label">DRAFTS</span><strong>{draftCount}</strong></div>
              <span className="stat-caption">still taking shape</span>
            </article>
          </section>

          <section className="posts-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">THE ARCHIVE</span>
                <h2>Your posts <span>{posts.length}</span></h2>
              </div>
              <button
                className="icon-button refresh-button"
                onClick={() => void loadPosts(true)}
                disabled={refreshing || loading}
                aria-label="Refresh posts"
                title="Refresh posts"
              >
                <ArrowDownUp className={refreshing ? "spin" : ""} size={17} />
              </button>
            </div>

            <div className="toolbar">
              <label className="search-box">
                <Search size={17} />
                <input
                  aria-label="Search posts"
                  placeholder="Search posts, tags, or keywords..."
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                {query && <button className="clear-search" onClick={() => setQuery("")} aria-label="Clear search"><X size={14} /></button>}
                {!query && <kbd>⌘ K</kbd>}
              </label>
              <label className="select-box">
                <Filter size={15} />
                <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                  <option>All categories</option>
                  {categories.map((category) => <option key={category}>{category}</option>)}
                </select>
                <ChevronDown size={14} />
              </label>
              <button className="filter-button" onClick={() => setStatusFilter(statusFilter === "all" ? "draft" : statusFilter === "draft" ? "published" : "all")}>
                <span className="filter-button-label">{statusFilter === "all" ? "All posts" : statusFilter}</span>
                <ChevronDown size={14} />
              </button>
            </div>

            <div className="tabs" role="tablist" aria-label="Filter by publication status">
              {(["all", "published", "draft"] as const).map((filter) => (
                <button
                  role="tab"
                  aria-selected={statusFilter === filter}
                  className={statusFilter === filter ? "tab active" : "tab"}
                  key={filter}
                  onClick={() => setStatusFilter(filter)}
                >
                  {filter === "all" ? "All posts" : filter === "published" ? "Published" : "Drafts"}
                  <span>{filter === "all" ? posts.length : posts.filter((post) => post.status === filter).length}</span>
                </button>
              ))}
            </div>

            {loadError && (
              <div className="load-error" role="alert">
                <div>
                  <strong>We couldn't reach your posts</strong>
                  <p>{loadError}</p>
                  <small>Check that MongoDB and the backend are running, and that <code>VITE_API_URL</code> points to the API.</small>
                </div>
                <button className="button button-secondary" onClick={() => void loadPosts()}>Try again</button>
              </div>
            )}

            <div className="posts-table-wrap">
              <table className="posts-table">
                <thead>
                  <tr>
                    <th>POST</th>
                    <th>CATEGORY</th>
                    <th>STATUS</th>
                    <th>LAST UPDATED</th>
                    <th><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={5} className="loading-cell"><LoaderCircle className="spin" size={20} /> Gathering your stories...</td></tr>
                  ) : !loadError && visiblePosts.length === 0 ? (
                    <tr>
                      <td colSpan={5}>
                        <div className="empty-state">
                          <div className="empty-illustration"><BookOpen size={24} /></div>
                          <h3>{query || categoryFilter !== "All categories" ? "No stories found" : "A blank page, full of possibility"}</h3>
                          <p>{query || categoryFilter !== "All categories" ? "Try a different search or filter." : "Your first story is just a few words away."}</p>
                          {!query && categoryFilter === "All categories" && (
                            <button className="button button-primary" onClick={() => setEditorPost(null)}><FilePlus2 size={16} /> Write a post</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : visiblePosts.map((post) => (
                    <tr key={post._id}>
                      <td>
                        <div className="post-cell">
                          {post.coverImage?.url
                            ? <img className="post-thumb" src={post.coverImage.url} alt="" />
                            : <div className={`post-thumb thumb-${post.category.toLowerCase()}`}><BookOpen size={16} /></div>}
                          <div className="post-info">
                            <strong>{post.title}</strong>
                            <span>{post.excerpt || `/${post.slug}`}</span>
                          </div>
                        </div>
                      </td>
                      <td><span className={`category-tag cat-${post.category.toLowerCase()}`}>{post.category}</span></td>
                      <td><span className={`status-pill ${post.status}`}><span className="status-dot" />{post.status}</span></td>
                      <td><span className="date-cell"><Clock3 size={14} />{formatDate(post.updatedAt)}</span></td>
                      <td>
                        <div className="row-actions">
                          <button
                            className="icon-button"
                            onClick={() => setEditorPost(post)}
                            title="Edit post"
                            aria-label={`Edit ${post.title}`}
                          ><Pencil size={16} /></button>
                          <button
                            className="icon-button danger-action"
                            onClick={() => void deletePost(post)}
                            disabled={deletingId === post._id}
                            title="Delete post"
                            aria-label={`Delete ${post.title}`}
                          >{deletingId === post._id ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}</button>
                          <button className="icon-button more-action" title="More actions" aria-label={`More actions for ${post.title}`} disabled><MoreHorizontal size={17} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer className="table-footer">
              <span>Showing <strong>{visiblePosts.length}</strong> of <strong>{posts.length}</strong> posts</span>
              <a href={API_URL} target="_blank" rel="noreferrer">API status <ArrowUpRight size={13} /></a>
            </footer>
          </section>
          <footer className="page-footer"><span>Made for the stories that stay with us.</span><span>THE WARRIOR WIZARD GIRL <span className="footer-sparkle">✳</span></span></footer>
        </div>
      </main>

      {editorPost !== undefined && (
        <PostEditor
          post={editorPost}
          onClose={() => setEditorPost(undefined)}
          onSaved={onSaved}
        />
      )}
      {toast && <div className="toast"><Check size={16} />{toast}</div>}
    </div>
  );
}
