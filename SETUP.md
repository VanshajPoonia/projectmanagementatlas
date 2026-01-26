# Project Management Dashboard Setup Guide

## Overview
A comprehensive project management system with admin controls, task management, real-time chat, and email notifications.

## Features
✅ **Admin Dashboard** - Manage users, boards, and tasks
✅ **Task Management** - Drag-and-drop Trello-like boards with status tracking
✅ **Email Restrictions** - Only approved emails can sign up
✅ **Real-time Chat** - Chat between admin and users with image uploads
✅ **Email Notifications** - Automatic task assignment notifications via FormSubmit
✅ **Role-based Access** - Admin vs Regular User permissions
✅ **Smooth Animations** - Polished UI with transitions and effects

## Database Setup

The database has been set up with the following tables:
- `profiles` - User profiles with role management
- `allowed_emails` - Whitelist of emails that can sign up
- `boards` - Project boards
- `columns` - Board columns (To Do, In Progress, Done, etc.)
- `tasks` - Tasks with assignments and priorities
- `chat_messages` - Chat messages between users and admin
- Storage bucket `chat-attachments` for file uploads

## Initial Setup Steps

### 1. Add Your Admin Email
Run this SQL in your Supabase SQL editor to add yourself as admin:

\`\`\`sql
INSERT INTO allowed_emails (email, role)
VALUES ('your-admin-email@example.com', 'admin');
\`\`\`

### 2. Add Team Members
Add additional users who should have access:

\`\`\`sql
INSERT INTO allowed_emails (email, role)
VALUES 
  ('user1@example.com', 'user'),
  ('user2@example.com', 'user'),
  ('user3@example.com', 'user');
\`\`\`

### 3. Configure Environment Variables
The following are automatically set by Supabase integration:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL`

### 4. Email Notifications
Email notifications use FormSubmit. When tasks are assigned, emails are sent via:
- Endpoint: `https://formsubmit.co/ajax/{user-email}`
- No API key needed

## User Roles

### Admin
- Access to `/admin` dashboard
- Manage all users and their access
- Create and manage boards
- Assign tasks to users
- View all tasks and boards
- Chat with all users

### Regular User
- Access to `/dashboard`
- View assigned tasks
- Update task status
- View boards they're assigned to
- Chat with admin

## Usage Flow

1. **Admin signs up** at `/signup` with approved email
2. **Admin adds more users** via Admin Dashboard → User Management
3. **Admin creates boards** for different projects
4. **Admin creates tasks** and assigns them to users
5. **Email sent automatically** to assigned user
6. **Users log in** and see their tasks
7. **Users update status** by dragging tasks between columns
8. **Admin and users communicate** via real-time chat

## Key Pages

- `/` - Landing page
- `/login` - Login page
- `/signup` - Signup (restricted to allowed emails)
- `/admin` - Admin dashboard
- `/admin/board/[id]` - Admin board view with full controls
- `/dashboard` - User dashboard
- `/dashboard/board/[id]` - User board view (their tasks only)

## Security Features

- Row Level Security (RLS) on all tables
- Email whitelist enforced at signup
- Role-based access control
- Secure file uploads with proper permissions
- Middleware for route protection

## Customization

### Adding More Columns
Edit the board to add custom columns (e.g., "Testing", "Review")

### Task Priorities
Tasks support: Low, Medium, High, Urgent

### Task Status
Default statuses: To Do, In Progress, Done, Blocked

## Support

For issues or questions, refer to the Supabase documentation or check the RLS policies in the database.
