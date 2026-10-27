-- Prints every to-do on Things 3's "Today" list to the Fox Todo receipt
-- printer, once each. Run on a schedule (see com.foxtodo.thingsbridge.plist
-- in this folder) — it keeps a local file of to-do IDs it has already sent
-- so re-runs don't reprint the same item.
--
-- First-time setup: set seedOnly to true below and run once (osascript
-- print-today.applescript) to mark everything currently on Today as already
-- seen, without printing it. Then set seedOnly back to false. Otherwise the
-- first real run prints your whole existing Today list at once.

property serverURL : "http://10.10.10.2:3000/api/print"
property addedByName : "Things"
property seedOnly : false

property seenDir : (POSIX path of (path to home folder)) & "Library/Application Support/FoxTodoBridge/"
property seenFile : seenDir & "seen-ids.txt"

on run
	do shell script "mkdir -p " & quoted form of seenDir
	do shell script "touch " & quoted form of seenFile

	set seenText to do shell script "cat " & quoted form of seenFile
	set seenIDs to paragraphs of seenText

	tell application "Things3"
		set todayToDos to to dos of list "Today"
		repeat with aToDo in todayToDos
			set toDoID to id of aToDo as string
			if seenIDs does not contain toDoID then
				if seedOnly then
					markSeen(toDoID)
				else
					set toDoName to name of aToDo as string
					set toDoNotes to ""
					try
						set toDoNotes to notes of aToDo as string
					end try

					set jsonBody to "{\"task\":\"" & jsonEscape(toDoName) & "\",\"notes\":\"" & jsonEscape(toDoNotes) & "\",\"addedBy\":\"" & jsonEscape(addedByName) & "\"}"
					set curlCmd to "curl -s -o /dev/null -w '%{http_code}' -X POST " & serverURL & " -H 'Content-Type: application/json' -d " & quoted form of jsonBody

					try
						set httpStatus to do shell script curlCmd
						if httpStatus starts with "2" then
							markSeen(toDoID)
						else
							log ("Print failed for " & toDoName & " — HTTP " & httpStatus)
						end if
					on error errMsg
						log ("Print request failed for " & toDoName & ": " & errMsg)
					end try
				end if
			end if
		end repeat
	end tell
end run

on markSeen(toDoID)
	do shell script "echo " & quoted form of toDoID & " >> " & quoted form of seenFile
end markSeen

on jsonEscape(txt)
	set txt to replaceText(txt, "\\", "\\\\")
	set txt to replaceText(txt, "\"", "\\\"")
	set txt to replaceText(txt, return, "\\n")
	set txt to replaceText(txt, linefeed, "\\n")
	set txt to replaceText(txt, tab, "\\t")
	return txt
end jsonEscape

on replaceText(sourceText, oldItem, newItem)
	set {tid, AppleScript's text item delimiters} to {AppleScript's text item delimiters, oldItem}
	set theItems to text items of sourceText
	set AppleScript's text item delimiters to newItem
	set newText to theItems as string
	set AppleScript's text item delimiters to tid
	return newText
end replaceText
