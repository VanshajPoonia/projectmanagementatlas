'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Send, Paperclip } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import ChatMessage from './chat-message'

interface ChatPanelProps {
  currentUserId: string
  isAdmin: boolean
  className?: string
}

export default function ChatPanel({ currentUserId, isAdmin, className }: ChatPanelProps) {
  const [messages, setMessages] = useState<any[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [selectedUser, setSelectedUser] = useState<string>('')
  const [users, setUsers] = useState<any[]>([])
  const [uploading, setUploading] = useState(false)
  const [unreadBySender, setUnreadBySender] = useState<Record<string, number>>({})
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const supabase = createClient()

  const selectedUserName = users.find((user) => user.id === selectedUser)?.full_name
    || users.find((user) => user.id === selectedUser)?.email
    || 'member'

  const loadUsers = useCallback(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, email, role')
      .neq('id', currentUserId)
      .order('full_name', { ascending: true, nullsFirst: false })

    const availableUsers = data || []
    setUsers(availableUsers)
    setSelectedUser((current) => (
      current && availableUsers.some((user: any) => user.id === current)
        ? current
        : availableUsers[0]?.id || ''
    ))
  }, [currentUserId, supabase])

  // How many unread messages I have from each other member ("who it was from").
  const loadUnread = useCallback(async () => {
    const { data } = await supabase
      .from('chat_messages')
      .select('sender_id')
      .eq('recipient_id', currentUserId)
      .is('read_at', null)
    const counts: Record<string, number> = {}
    for (const row of data || []) counts[row.sender_id] = (counts[row.sender_id] || 0) + 1
    setUnreadBySender(counts)
  }, [currentUserId, supabase])

  const loadMessages = useCallback(async () => {
    if (!selectedUser) {
      setMessages([])
      return
    }

    const { data } = await supabase
      .from('chat_messages')
      .select('*, sender:profiles!chat_messages_sender_id_fkey(full_name, email)')
      .or(
        `and(sender_id.eq.${currentUserId},recipient_id.eq.${selectedUser}),and(sender_id.eq.${selectedUser},recipient_id.eq.${currentUserId})`
      )
      .order('created_at', { ascending: true })

    if (data) setMessages(data)

    // Opening a conversation marks its incoming messages as read.
    await supabase
      .from('chat_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('recipient_id', currentUserId)
      .eq('sender_id', selectedUser)
      .is('read_at', null)
    loadUnread()
  }, [currentUserId, selectedUser, supabase, loadUnread])

  useEffect(() => {
    loadUsers()
    loadUnread()
  }, [loadUsers, loadUnread])

  useEffect(() => {
    loadMessages()

    if (!selectedUser) return

    const channel = supabase
      .channel(`chat-messages-${currentUserId}-${selectedUser}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_messages',
        },
        loadMessages
      )
      .subscribe()

    const interval = setInterval(loadMessages, 5000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(interval)
    }
  }, [currentUserId, loadMessages, selectedUser, supabase])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMessage.trim() || !selectedUser) return

    const { error } = await supabase.from('chat_messages').insert({
      sender_id: currentUserId,
      recipient_id: selectedUser,
      message: newMessage.trim(),
    })

    if (!error) {
      setNewMessage('')
      loadMessages()
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !selectedUser) return

    setUploading(true)

    try {
      const fileExt = file.name.split('.').pop()
      const fileName = `${crypto.randomUUID()}.${fileExt}`
      const filePath = `${currentUserId}/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('chat-attachments')
        .upload(filePath, file)

      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage
        .from('chat-attachments')
        .getPublicUrl(filePath)

      await supabase.from('chat_messages').insert({
        sender_id: currentUserId,
        recipient_id: selectedUser,
        message: file.type.startsWith('image/') ? 'Image' : `File: ${file.name}`,
        image_url: publicUrl,
      })

      loadMessages()
    } catch (error) {
      console.error('Error uploading file:', error)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <Card className={cn('flex h-[min(72vh,640px)] min-h-[460px] flex-col overflow-hidden', className)}>
      <CardHeader className="border-b p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base">
              {selectedUser ? `Chat with ${selectedUserName}` : 'Team chat'}
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {isAdmin ? 'Talk to any team member' : 'Talk to admins or teammates'}
            </p>
          </div>
          <Select value={selectedUser} onValueChange={setSelectedUser}>
            <SelectTrigger className="h-10 sm:w-64">
              <SelectValue placeholder="Choose a member" />
            </SelectTrigger>
            <SelectContent>
              {users.map((user) => {
                const unread = unreadBySender[user.id] || 0
                return (
                  <SelectItem key={user.id} value={user.id}>
                    <span className="flex w-full items-center justify-between gap-2">
                      <span>{user.full_name || user.email}</span>
                      {unread > 0 && (
                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-semibold text-white">
                          {unread > 99 ? '99+' : unread}
                        </span>
                      )}
                    </span>
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.map((message) => (
          <ChatMessage
            key={message.id}
            message={message}
            isOwn={message.sender_id === currentUserId}
          />
        ))}
        <div ref={messagesEndRef} />

        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
            {selectedUser ? 'No messages yet. Start the conversation.' : 'Choose a member to start chatting.'}
          </div>
        )}
      </CardContent>

      <div className="border-t p-4">
        <form onSubmit={handleSendMessage} className="flex gap-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            className="hidden"
            accept="image/*,.pdf,.doc,.docx"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || !selectedUser}
          >
            <Paperclip className="w-4 h-4" />
          </Button>
          <Input
            placeholder={selectedUser ? 'Type a message...' : 'Choose a member first'}
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            disabled={uploading || !selectedUser}
          />
          <Button
            type="submit"
            size="icon"
            disabled={uploading || !selectedUser || !newMessage.trim()}
          >
            <Send className="w-4 h-4" />
          </Button>
        </form>
      </div>
    </Card>
  )
}
