'use client'

import React from "react"

import { useState, useEffect, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Send, ImageIcon, Paperclip } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import ChatMessage from './chat-message'

interface ChatPanelProps {
  currentUserId: string
  isAdmin: boolean
}

export default function ChatPanel({ currentUserId, isAdmin }: ChatPanelProps) {
  const [messages, setMessages] = useState<any[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [selectedUser, setSelectedUser] = useState<string>('')
  const [users, setUsers] = useState<any[]>([])
  const [uploading, setUploading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const supabase = createClient()

  useEffect(() => {
    loadUsers()
    loadMessages()

    // Subscribe to real-time messages
    const channel = supabase
      .channel('chat-messages')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_messages',
        },
        () => {
          loadMessages()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [selectedUser])

  const loadUsers = async () => {
    if (isAdmin) {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, email, role')
        .neq('id', currentUserId)
        .order('full_name')
      
      if (data) setUsers(data)
    } else {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .eq('role', 'admin')
      
      if (data) {
        setUsers(data)
        if (data.length > 0) setSelectedUser(data[0].id)
      }
    }
  }

  const loadMessages = async () => {
    if (!selectedUser && !isAdmin) return

    let query = supabase
      .from('chat_messages')
      .select('*, sender:profiles!chat_messages_sender_id_fkey(full_name, email)')
      .order('created_at', { ascending: true })

    if (isAdmin && selectedUser) {
      query = query.or(`sender_id.eq.${selectedUser},recipient_id.eq.${selectedUser}`)
    } else if (!isAdmin) {
      query = query.or(`sender_id.eq.${currentUserId},recipient_id.eq.${currentUserId}`)
    }

    const { data } = await query
    if (data) setMessages(data)
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMessage.trim()) return

    const receiverId = isAdmin ? selectedUser : users[0]?.id
    if (!receiverId) return

    await supabase.from('chat_messages').insert({
      sender_id: currentUserId,
      recipient_id: receiverId,
      message: newMessage,
    })

    setNewMessage('')
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    
    try {
      const fileExt = file.name.split('.').pop()
      const fileName = `${Math.random()}.${fileExt}`
      const filePath = `${currentUserId}/${fileName}`

      const { error: uploadError, data } = await supabase.storage
        .from('chat-attachments')
        .upload(filePath, file)

      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage
        .from('chat-attachments')
        .getPublicUrl(filePath)

      const receiverId = isAdmin ? selectedUser : users[0]?.id
      if (!receiverId) return

      await supabase.from('chat_messages').insert({
        sender_id: currentUserId,
        recipient_id: receiverId,
        message: file.type.startsWith('image/') ? '📷 Image' : '📎 File',
        image_url: publicUrl,
      })
    } catch (error) {
      console.error('Error uploading file:', error)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-4">
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Select User</CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={selectedUser} onValueChange={setSelectedUser}>
              <SelectTrigger>
                <SelectValue placeholder="Select a user to chat with" />
              </SelectTrigger>
              <SelectContent>
                {users.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.full_name || user.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      )}

      <Card className="h-[600px] flex flex-col">
        <CardHeader className="border-b">
          <CardTitle>
            {isAdmin 
              ? selectedUser 
                ? `Chat with ${users.find(u => u.id === selectedUser)?.full_name || 'User'}`
                : 'Select a user to start chatting'
              : `Chat with Admin`
            }
          </CardTitle>
        </CardHeader>
        
        <CardContent className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((message) => (
            <ChatMessage 
              key={message.id} 
              message={message} 
              isOwn={message.sender_id === currentUserId}
            />
          ))}
          <div ref={messagesEndRef} />
          
          {messages.length === 0 && (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              No messages yet. Start a conversation!
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
              disabled={uploading || (!isAdmin && !selectedUser)}
            >
              <Paperclip className="w-4 h-4" />
            </Button>
            <Input
              placeholder="Type a message..."
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              disabled={uploading || (!isAdmin && !selectedUser)}
            />
            <Button 
              type="submit" 
              size="icon"
              disabled={uploading || (!isAdmin && !selectedUser)}
            >
              <Send className="w-4 h-4" />
            </Button>
          </form>
        </div>
      </Card>
    </div>
  )
}
