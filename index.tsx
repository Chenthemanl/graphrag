/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Type, Chat } from '@google/genai';
import * as pdfjsLib from 'pdfjs-dist';

// Configure the PDF.js worker to enable PDF parsing
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://esm.sh/pdfjs-dist@4.4.168/build/pdf.worker.mjs';

// --- DOM Element References ---
const articleInput = document.getElementById('article-input') as HTMLTextAreaElement;
const processButton = document.getElementById('process-button') as HTMLButtonElement;
const knowledgeBaseContainer = document.getElementById('knowledge-base-container') as HTMLElement;
const knowledgeList = document.getElementById('knowledge-list') as HTMLElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const fileNameDisplay = document.getElementById('file-name-display') as HTMLSpanElement;

// Literature Review Section
const literatureReviewSection = document.getElementById('literature-review-section') as HTMLElement;
const reviewForm = document.getElementById('review-form') as HTMLFormElement;
const reviewTopicInput = document.getElementById('review-topic-input') as HTMLInputElement;
const generateReviewButton = document.getElementById('generate-review-button') as HTMLButtonElement;
const reviewGenerationProgress = document.getElementById('review-generation-progress') as HTMLElement;
const reviewProgressLog = document.getElementById('review-progress-log') as HTMLElement;
const reviewDraftOutput = document.getElementById('review-draft-output') as HTMLElement;
const draftVersionControls = document.getElementById('draft-version-controls') as HTMLElement;

// Writing Assistant Section
const writingAssistantSection = document.getElementById('writing-assistant-section') as HTMLElement;
const editorToolbar = document.querySelector('.editor-toolbar') as HTMLElement;
const writingEditor = document.getElementById('writing-editor') as HTMLElement;
const analyzeTextButton = document.getElementById('analyze-text-button') as HTMLButtonElement;
const suggestionsPanel = document.getElementById('suggestions-panel') as HTMLElement;
const similarityCheckButton = document.getElementById('similarity-check-button') as HTMLButtonElement;
const referencesContainer = document.getElementById('references-container') as HTMLElement;
const referencesList = document.getElementById('references-list') as HTMLElement;


// Q&A Section
const qaSection = document.getElementById('qa-section') as HTMLElement;
const chatContainer = document.getElementById('chat-container') as HTMLElement;
const chatForm = document.getElementById('chat-form') as HTMLFormElement;
const questionInput = document.getElementById('question-input') as HTMLInputElement;
const chatButton = chatForm.querySelector('button') as HTMLButtonElement;

const loader = document.getElementById('loader') as HTMLElement;
const loaderText = loader.querySelector('p') as HTMLParagraphElement;

// --- App State ---
interface KnowledgeSource {
    fileName: string;
    author: string;
    year: string;
    summary: string;
    entities: string[];
    fullText: string;
}

interface Suggestion {
    category: string;
    issue: string;
    suggestion: string;
    explanation: string;
}

let isLoading = false;
let knowledgeSources: KnowledgeSource[] = [];
let currentFileName = '';
let draftHistory: string[] = [];
let chat: Chat | null = null;
let analysisSuggestions: Suggestion[] = [];
let activeSimilarityHighlight: HTMLElement | null = null;

// Ensure API key is available
if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable not set.");
}
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * Updates the UI based on the loading state.
 */
function setLoading(loading: boolean, text = 'Processing...') {
    isLoading = loading;
    loader.classList.toggle('hidden', !loading);
    loaderText.textContent = text;
    processButton.disabled = loading || !articleInput.value;
    fileInput.disabled = loading;
    generateReviewButton.disabled = loading;
    analyzeTextButton.disabled = loading;
    similarityCheckButton.disabled = loading;
    questionInput.disabled = loading || knowledgeSources.length === 0;
    chatButton.disabled = loading || knowledgeSources.length === 0;
}

/**
 * Renders the list of all processed knowledge sources.
 */
function renderKnowledgeSources() {
    knowledgeList.innerHTML = '';
    if (knowledgeSources.length > 0) {
        knowledgeBaseContainer.classList.remove('hidden');
        literatureReviewSection.classList.remove('hidden');
        qaSection.classList.remove('hidden');
    }

    knowledgeSources.forEach(source => {
        const card = document.createElement('div');
        card.className = 'knowledge-source-card';
        card.innerHTML = `
            <h4>${source.fileName}</h4>
            <p><strong>Author:</strong> ${source.author} | <strong>Year:</strong> ${source.year}</p>
            <h5>Summary</h5>
            <p>${source.summary}</p>
            <h5>Key Entities</h5>
            <ul id="entities-output">
                ${source.entities.map(e => `<li>${e}</li>`).join('')}
            </ul>
        `;
        knowledgeList.appendChild(card);
    });
}

/**
 * Analyzes a document's text and adds it to the knowledge base.
 * @param fileName The name of the document.
 * @param articleText The full text content of the document.
 */
async function analyzeAndStoreDocument(fileName: string, articleText: string) {
    if (knowledgeSources.some(s => s.fileName === fileName)) {
        console.warn(`Skipping duplicate file: ${fileName}`);
        return;
    }

    chat = null; // Reset chat on new knowledge

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `Analyze the following article text. Extract the primary author's last name, the publication year, a concise one-paragraph summary, and a list of key entities. Article:\n\n${articleText}`,
            config: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        author: { type: Type.STRING, description: "The primary author's last name (e.g., 'Smith')." },
                        year: { type: Type.STRING, description: "The 4-digit publication year (e.g., '2023')." },
                        summary: { type: Type.STRING, description: 'A concise, one-paragraph summary.' },
                        entities: { type: Type.ARRAY, items: { type: Type.STRING } },
                    },
                    required: ['author', 'year', 'summary', 'entities'],
                },
            },
        });

        const parsedResponse = JSON.parse(response.text);
        knowledgeSources.push({
            fileName: fileName,
            author: parsedResponse.author,
            year: parsedResponse.year,
            summary: parsedResponse.summary,
            entities: parsedResponse.entities,
            fullText: articleText
        });

        renderKnowledgeSources();
    } catch (error) {
        console.error(`Error analyzing article: ${fileName}`, error);
        throw new Error(`Failed to analyze ${fileName}.`);
    }
}


/**
 * Handles adding text from the textarea to the knowledge base.
 */
async function handleProcessArticle() {
    const articleText = articleInput.value.trim();
    if (!articleText) {
        alert('Please paste text into the text area or upload a file.');
        return;
    }

    // Use the current file name if available, otherwise generate a name for pasted content.
    const docName = currentFileName || `Pasted Content ${knowledgeSources.filter(s => s.fileName.startsWith("Pasted Content")).length + 1}`;

    if (knowledgeSources.some(s => s.fileName === docName)) {
        alert(`"${docName}" has already been added to the knowledge base.`);
        return;
    }

    setLoading(true, `Analyzing ${docName}...`);

    try {
        await analyzeAndStoreDocument(docName, articleText);

        // Clear inputs after successful processing
        articleInput.value = '';
        fileInput.value = '';
        fileNameDisplay.textContent = '';
        currentFileName = '';

    } catch (error) {
        alert('An error occurred while building the knowledge base.');
    } finally {
        setLoading(false);
    }
}

/**
 * Handles the file input change event for single or multiple files.
 */
async function handleFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (!files || files.length === 0) {
        fileNameDisplay.textContent = '';
        currentFileName = '';
        return;
    }
    
    // For single file uploads, display the content in the textarea.
    // For multiple, we process them directly.
    if (files.length === 1) {
        const file = files[0];
        fileNameDisplay.textContent = `Selected: ${file.name}`;
        currentFileName = file.name;
        articleInput.value = ''; // Clear previous content

        setLoading(true, `Parsing ${file.name}...`);
        try {
            let fullText = '';
            if (file.type === 'application/pdf') {
                const arrayBuffer = await file.arrayBuffer();
                const pdf = await (pdfjsLib.getDocument(arrayBuffer).promise as Promise<any>);
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    fullText += textContent.items.map((item: any) => item.str ?? '').join(' ') + '\n\n';
                }
            } else {
                fullText = await file.text();
            }
            articleInput.value = fullText.trim();
        } catch (error) {
            console.error('Error processing file:', error);
            fileNameDisplay.textContent = 'Error processing file.';
            currentFileName = '';
            alert(`Error processing ${file.name}. Please ensure it's a valid text or PDF file.`);
        } finally {
            setLoading(false);
        }
    } else {
        // Handle multiple files
        const fileNames = Array.from(files).map(f => f.name).join(', ');
        fileNameDisplay.textContent = `Selected ${files.length} files: ${fileNames}`;
        processButton.disabled = true; // Disable manual button during batch processing

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            setLoading(true, `Processing ${i + 1}/${files.length}: ${file.name}`);

            try {
                let fullText = '';
                if (file.type === 'application/pdf') {
                    const arrayBuffer = await file.arrayBuffer();
                    const pdf = await (pdfjsLib.getDocument(arrayBuffer).promise as Promise<any>);
                     for (let j = 1; j <= pdf.numPages; j++) {
                        const page = await pdf.getPage(j);
                        const textContent = await page.getTextContent();
                        fullText += textContent.items.map((item: any) => item.str ?? '').join(' ') + '\n\n';
                    }
                } else {
                    fullText = await file.text();
                }
                
                await analyzeAndStoreDocument(file.name, fullText.trim());

            } catch (error) {
                console.error(`Error processing file ${file.name}:`, error);
                alert(`An error occurred while processing ${file.name}. Skipping to the next file.`);
            }
        }
        
        // Cleanup after loop
        setLoading(false);
        fileNameDisplay.textContent = `${files.length} file(s) processed.`;
        fileInput.value = ''; // Reset file input
        processButton.disabled = false;
    }
}

/**
 * Routes review generation to the correct handler based on user choice.
 */
async function handleGenerateReview(event: SubmitEvent) {
    event.preventDefault();
    const topic = reviewTopicInput.value.trim();
    if (!topic) return;

    // Reset UI
    reviewGenerationProgress.classList.remove('hidden');
    writingAssistantSection.classList.add('hidden');
    reviewProgressLog.innerHTML = '';
    reviewDraftOutput.innerHTML = '';
    draftVersionControls.innerHTML = '';
    draftHistory = [];
    referencesContainer.classList.add('hidden');
    referencesList.innerHTML = '';

    const reviewLength = (document.querySelector('input[name="review-length"]:checked') as HTMLInputElement).value;
    const knowledgeContext = knowledgeSources.map(s => `--- DOCUMENT: ${s.fileName}\nAUTHOR: ${s.author}\nYEAR: ${s.year}\nSUMMARY: ${s.summary}\n---`).join('\n\n');

    try {
        if (reviewLength === 'detailed') {
            await generateDetailedReview(topic, knowledgeContext);
        } else {
            await generateConciseReview(topic, knowledgeContext);
        }

        addProgressLog('<strong>Final Draft Generated.</strong> Moving to Writing Assistant.');
        renderDraftViewer();
        const finalDraft = draftHistory[draftHistory.length - 1] || '';
        writingEditor.innerHTML = `<div>${finalDraft.replace(/\n/g, '</div><div>')}</div>`;
        generateBibliography();
        writingAssistantSection.classList.remove('hidden');

    } catch (error) {
        console.error('Error generating literature review:', error);
        addProgressLog('An error occurred during generation.');
        alert('An error occurred. Please check the console.');
    } finally {
        setLoading(false);
    }
}

/**
 * Generates a short, one-paragraph literature review.
 */
async function generateConciseReview(topic: string, knowledgeContext: string) {
    setLoading(true, 'Generating concise review...');
    addProgressLog('<strong>Step 1:</strong> Generating concise draft...');
    
    const prompt = `Based on the following knowledge base, write a concise, one-paragraph literature review on the topic: "${topic}". Compare and contrast the key findings. IMPORTANT: When you use information from a source, you MUST include an APA-style in-text citation, like this: (Author, Year). Do not use markdown.\n\nKNOWLEDGE BASE:\n${knowledgeContext}`;
    const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
    
    const draft = response.text;
    draftHistory.push(draft);
    reviewDraftOutput.innerHTML = draft.replace(/\n/g, '<br>');
    addProgressLog('Concise draft created.');
}

/**
 * Generates a detailed, multi-section literature review following an academic structure.
 */
async function generateDetailedReview(topic: string, knowledgeContext: string) {
    let fullDraftParts: string[] = [];

    // Step 1: Generate Outline
    setLoading(true, 'Step 1: Creating a structured outline...');
    addProgressLog('<strong>Step 1:</strong> Creating a structured outline...');
    const outlineResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Based on the provided knowledge base, create a structured outline for an academic literature review on "${topic}". Identify key themes for the body based on comparing, contrasting, and evaluating the sources. Respond in JSON. KNOWLEDGE BASE:\n${knowledgeContext}`,
        config: {
            responseMimeType: 'application/json',
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    introduction: { type: Type.STRING, description: "A brief plan for the introduction, stating the topic and scope." },
                    themes: { type: Type.ARRAY, description: "An array of 2-3 main themes or arguments to discuss in the body.", items: { type: Type.STRING } },
                    conclusion: { type: Type.STRING, description: "A brief plan for the conclusion, summarizing key findings and gaps." }
                },
                required: ["introduction", "themes", "conclusion"]
            }
        }
    });
    const outline = JSON.parse(outlineResponse.text);
    const outlineHtml = `<h3>Outline</h3><ul><li>Introduction</li><li>Body Paragraphs:<ul>${outline.themes.map((t: string) => `<li>${t}</li>`).join('')}</ul></li><li>Conclusion</li></ul>`;
    draftHistory.push(outlineHtml);
    reviewDraftOutput.innerHTML = outlineHtml;
    addProgressLog('Outline created. Now writing sections...');

    // Step 2: Write Introduction
    setLoading(true, `Step 2: Writing introduction...`);
    addProgressLog(`<strong>Step 2:</strong> Writing the introduction...`);
    const introPrompt = `Write the introduction for a literature review on "${topic}", following this plan: ${outline.introduction}. Use the provided knowledge base and include APA-style (Author, Year) citations. Output only the introduction text. KNOWLEDGE BASE:\n${knowledgeContext}`;
    const introText = (await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: introPrompt })).text;
    fullDraftParts.push(introText);
    draftHistory.push(fullDraftParts.join('\n\n'));
    reviewDraftOutput.innerHTML = fullDraftParts.map(p => p.replace(/\n/g, '<br>')).join('<br><br>');

    // Step 3: Write Body Paragraphs for each theme
    for (let i = 0; i < outline.themes.length; i++) {
        const theme = outline.themes[i];
        setLoading(true, `Step ${3+i}: Developing theme: ${theme}`);
        addProgressLog(`<strong>Step ${3+i}:</strong> Developing theme: <em>"${theme}"</em>...`);
        const themePrompt = `Write a body paragraph for a literature review on the theme: "${theme}". Compare and contrast sources, evaluate arguments, and connect back to the main topic of "${topic}". Cite sources with (Author, Year). Use the provided knowledge base. Output only the paragraph text. KNOWLEDGE BASE:\n${knowledgeContext}`;
        const themeText = (await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: themePrompt })).text;
        fullDraftParts.push(themeText);
        draftHistory.push(fullDraftParts.join('\n\n'));
        reviewDraftOutput.innerHTML = fullDraftParts.map(p => p.replace(/\n/g, '<br>')).join('<br><br>');
    }

    // Step 4: Write Conclusion
    const conclusionStep = 3 + outline.themes.length;
    setLoading(true, `Step ${conclusionStep}: Writing conclusion...`);
    addProgressLog(`<strong>Step ${conclusionStep}:</strong> Writing the conclusion...`);
    const conclusionPrompt = `Write the conclusion for a literature review on "${topic}", following this plan: ${outline.conclusion}. Use the provided knowledge base and cite with (Author, Year). Output only the conclusion text. KNOWLEDGE BASE:\n${knowledgeContext}`;
    const conclusionText = (await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: conclusionPrompt })).text;
    fullDraftParts.push(conclusionText);
    draftHistory.push(fullDraftParts.join('\n\n'));
    reviewDraftOutput.innerHTML = fullDraftParts.map(p => p.replace(/\n/g, '<br>')).join('<br><br>');
}


function addProgressLog(html: string) {
    reviewProgressLog.innerHTML += `<div class="log-entry">${html}</div>`;
    reviewProgressLog.scrollTop = reviewProgressLog.scrollHeight;
}

/**
 * Renders the draft history buttons and sets up their event listeners.
 */
function renderDraftViewer() {
    draftVersionControls.innerHTML = '';
    if (draftHistory.length === 0) return;

    draftHistory.forEach((_, index) => {
        const button = document.createElement('button');
        button.className = 'version-button';
        button.dataset.index = index.toString();
        
        if (index === 0) {
            button.textContent = 'Outline';
        } else if (index === draftHistory.length - 1) {
            button.textContent = 'Final';
        } else {
            button.textContent = `Step ${index}`;
        }

        draftVersionControls.appendChild(button);
    });

    // Set the last version as active initially
    const lastButton = draftVersionControls.children[draftHistory.length - 1] as HTMLButtonElement;
    if (lastButton) {
        lastButton.classList.add('active');
    }
}

/**
 * Handles clicks on the version history buttons.
 * @param event The mouse click event.
 */
function handleVersionChange(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.classList.contains('version-button')) return;

    // Remove active class from all buttons
    const buttons = draftVersionControls.querySelectorAll('.version-button');
    buttons.forEach(btn => btn.classList.remove('active'));

    // Add active class to the clicked button
    target.classList.add('active');

    const index = parseInt(target.dataset.index || '0');
    const draftText = draftHistory[index] || 'Could not load this version.';
    reviewDraftOutput.innerHTML = draftText.replace(/\n/g, '<br>');
}

/**
 * Generates and displays an APA-style bibliography from cited sources.
 */
function generateBibliography() {
    const finalDraft = writingEditor.innerHTML;
    const citedSources: KnowledgeSource[] = [];

    knowledgeSources.forEach(source => {
        const citation = `(${source.author}, ${source.year})`;
        if (finalDraft.includes(citation)) {
            if (!citedSources.some(s => s.fileName === source.fileName)) {
                citedSources.push(source);
            }
        }
    });

    if (citedSources.length > 0) {
        referencesList.innerHTML = '';
        citedSources
            .sort((a, b) => a.author.localeCompare(b.author))
            .forEach(source => {
                const ref = document.createElement('div');
                // Basic APA format
                ref.textContent = `${source.author}. (${source.year}). ${source.fileName.replace(/\.(txt|pdf|md)$/i, '')}.`;
                referencesList.appendChild(ref);
            });
        referencesContainer.classList.remove('hidden');
    } else {
        referencesContainer.classList.add('hidden');
    }
}


/**
 * Handles the "Analyze Text" button click for the writing assistant.
 */
async function handleAnalyzeText() {
    const text = writingEditor.innerText.trim();
    if (!text) return;

    setLoading(true, 'Analyzing text...');
    suggestionsPanel.innerHTML = '<div class="placeholder">Analyzing...</div>';

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `Analyze the following text for grammar, spelling, punctuation, and style issues. Respond with a JSON array of suggestion objects. Each object must have: "category" (one of "Grammar", "Spelling", "Punctuation", "Style", "Clarity"), "issue" (the exact text with the problem), "suggestion" (the corrected text), and "explanation".\n\nTEXT:\n"${text}"`,
            config: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            category: { type: Type.STRING },
                            issue: { type: Type.STRING },
                            suggestion: { type: Type.STRING },
                            explanation: { type: Type.STRING },
                        },
                        required: ["category", "issue", "suggestion", "explanation"]
                    },
                }
            }
        });

        analysisSuggestions = JSON.parse(response.text) as Suggestion[];
        renderSuggestions();

    } catch (error) {
        console.error('Error analyzing text:', error);
        suggestionsPanel.innerHTML = '<div class="placeholder">Failed to get suggestions.</div>';
    } finally {
        setLoading(false);
    }
}

/**
 * Renders the list of AI suggestions.
 */
function renderSuggestions() {
    suggestionsPanel.innerHTML = '';
    if (analysisSuggestions.length === 0) {
        suggestionsPanel.innerHTML = '<div class="placeholder">No suggestions found! The text looks great.</div>';
        return;
    }

    analysisSuggestions.forEach((s, index) => {
        const card = document.createElement('div');
        card.className = 'suggestion-card';
        card.innerHTML = `
            <div class="suggestion-card-header">
                <span class="suggestion-category ${s.category}">${s.category}</span>
                <div class="suggestion-actions">
                    <button class="accept" data-index="${index}" title="Accept suggestion">
                         <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>
                    </button>
                    <button class="reject" data-index="${index}" title="Reject suggestion">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                    </button>
                </div>
            </div>
            <div class="suggestion-body">
                <span class="issue">${s.issue}</span>
                <span class="arrow">→</span>
                <span class="fix">${s.suggestion}</span>
            </div>
            <p class="suggestion-explanation">${s.explanation}</p>
        `;
        suggestionsPanel.appendChild(card);
    });
}

function handleSuggestionClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    const button = target.closest('button');
    if (!button) return;

    const index = parseInt(button.dataset.index || '-1');
    if (index === -1) return;

    const suggestion = analysisSuggestions[index];

    if (button.classList.contains('accept')) {
        writingEditor.innerHTML = writingEditor.innerHTML.replace(suggestion.issue, `<strong>${suggestion.suggestion}</strong>`);
    }

    // Remove suggestion and re-render
    analysisSuggestions.splice(index, 1);
    renderSuggestions();
}

/**
 * Handles the chat form submission to ask a question.
 */
async function handleAskQuestion(event: SubmitEvent) {
    event.preventDefault();
    const userQuestion = questionInput.value.trim();
    if (!userQuestion || isLoading || knowledgeSources.length === 0) return;

    setLoading(true, 'Thinking...');
    addMessageToChat(userQuestion, 'user');
    questionInput.value = '';

    try {
        if (!chat) {
            const context = knowledgeSources.map(s => `--- DOCUMENT: ${s.fileName} ---\nSummary: ${s.summary}\n---`).join('\n\n');
            const systemInstruction = `You are an expert Q&A assistant. Answer the user's question based *only* on the provided knowledge base. If the answer isn't in the documents, say so clearly.\n\nKNOWLEDGE BASE:\n${context}`;
            chat = ai.chats.create({ model: 'gemini-2.5-flash', config: { systemInstruction } });
        }
        
        const response = await chat.sendMessage({ message: userQuestion });
        addMessageToChat(response.text, 'model');

    } catch (error) {
        console.error('Error sending message:', error);
        addMessageToChat('Sorry, I encountered an error.', 'model');
    } finally {
        setLoading(false);
        questionInput.focus();
    }
}

/**
 * Checks draft for similarity against source documents using a single, efficient API call.
 */
async function handleSimilarityCheck() {
    const draftText = writingEditor.innerText;
    if (draftText.trim().length < 50) {
        alert("Please write more text before checking for similarity.");
        return;
    }

    setLoading(true, 'Checking for similarity...');
    removeHighlights(); // Clear previous results

    const allSourcesText = knowledgeSources.map((s, i) => `--- SOURCE ${i+1}: ${s.fileName} ---\n${s.fullText}`).join('\n\n');

    const checkPrompt = `You are a plagiarism detection expert. Analyze the "DRAFT TEXT" below. Compare it against all the provided "SOURCE DOCUMENTS".
    Identify every sentence in the draft that is a direct copy or a very close paraphrase of any part of any source document.
    For each match you find, generate a rewritten suggestion that maintains the original meaning but uses a different structure and vocabulary.
    Respond with a single JSON array. Each object in the array must contain:
    1. "original_sentence": The exact sentence from the draft that is too similar.
    2. "similar_passage_from_source": The corresponding passage from the source document.
    3. "source_filename": The filename of the source document it matches.
    4. "rewritten_suggestion": Your rewritten version of the sentence.
    If no similar sentences are found, return an empty array.

    DRAFT TEXT:
    "${draftText}"

    SOURCE DOCUMENTS:
    ${allSourcesText}
    `;

    try {
        const simResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: checkPrompt,
            config: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            original_sentence: { type: Type.STRING },
                            similar_passage_from_source: { type: Type.STRING },
                            source_filename: { type: Type.STRING },
                            rewritten_suggestion: { type: Type.STRING }
                        },
                        required: ["original_sentence", "similar_passage_from_source", "source_filename", "rewritten_suggestion"]
                    }
                }
            }
        });
        const results = JSON.parse(simResponse.text);

        if (results.length === 0) {
            alert("No significant similarities found.");
        } else {
            results.forEach((result: any) => {
                highlightText(result.original_sentence, `${result.similar_passage_from_source} (from ${result.source_filename})`, result.rewritten_suggestion);
            });
            alert(`Found ${results.length} potential similarities. Click on the highlighted text to review.`);
        }
    } catch (err) {
        console.error("Similarity check failed:", err);
        alert("An error occurred during the similarity check. Please try again.");
    } finally {
        setLoading(false);
    }
}


/** Removes all similarity highlights from the editor. */
function removeHighlights() {
    const highlights = writingEditor.querySelectorAll('.similarity-highlight');
    highlights.forEach(span => {
        span.replaceWith(document.createTextNode(span.textContent || ''));
    });
    writingEditor.normalize(); // Merges adjacent text nodes
}

/** Highlights a specific text segment in the editor. */
function highlightText(textToFind: string, original: string, suggestion: string) {
    const treeWalker = document.createTreeWalker(writingEditor, NodeFilter.SHOW_TEXT);
    let currentNode;
    while (currentNode = treeWalker.nextNode()) {
        const textNode = currentNode as Text;
        const index = textNode.nodeValue!.indexOf(textToFind);
        if (index !== -1) {
            const range = document.createRange();
            range.setStart(textNode, index);
            range.setEnd(textNode, index + textToFind.length);

            const highlightSpan = document.createElement('span');
            highlightSpan.className = 'similarity-highlight';
            highlightSpan.dataset.original = original;
            highlightSpan.dataset.suggestion = suggestion;
            range.surroundContents(highlightSpan);
            return; // Highlight only the first occurrence
        }
    }
}

function showSimilarityTooltip(highlightElement: HTMLElement) {
    activeSimilarityHighlight = highlightElement;
    let tooltip = document.getElementById('similarity-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'similarity-tooltip';
        document.body.appendChild(tooltip);
    }
    tooltip.innerHTML = `
        <h4>Potential Similarity Found</h4>
        <p>This text is very similar to the original source:</p>
        <blockquote class="original-text">${highlightElement.dataset.original}</blockquote>
        <p>Suggested Revision:</p>
        <blockquote class="suggestion-text">${highlightElement.dataset.suggestion}</blockquote>
        <div id="similarity-tooltip-actions">
            <button id="similarity-accept" class="button-primary">Accept Suggestion</button>
            <button id="similarity-dismiss" class="button-secondary">Dismiss</button>
        </div>
    `;
    const rect = highlightElement.getBoundingClientRect();
    tooltip.style.left = `${rect.left}px`;
    tooltip.style.top = `${rect.bottom + window.scrollY + 5}px`;
    tooltip.classList.remove('hidden');

    document.getElementById('similarity-accept')?.addEventListener('click', acceptSimilaritySuggestion, { once: true });
    document.getElementById('similarity-dismiss')?.addEventListener('click', dismissSimilaritySuggestion, { once: true });
}

function hideSimilarityTooltip() {
    const tooltip = document.getElementById('similarity-tooltip');
    if (tooltip) tooltip.classList.add('hidden');
    activeSimilarityHighlight = null;
}

function acceptSimilaritySuggestion() {
    if (activeSimilarityHighlight) {
        activeSimilarityHighlight.replaceWith(document.createTextNode(activeSimilarityHighlight.dataset.suggestion || ''));
        writingEditor.normalize();
    }
    hideSimilarityTooltip();
}
function dismissSimilaritySuggestion() {
    if (activeSimilarityHighlight) {
        activeSimilarityHighlight.replaceWith(document.createTextNode(activeSimilarityHighlight.textContent || ''));
        writingEditor.normalize();
    }
    hideSimilarityTooltip();
}

function addMessageToChat(text: string, sender: 'user' | 'model') {
    const messageElement = document.createElement('div');
    messageElement.classList.add('chat-message', sender);
    messageElement.textContent = text;
    chatContainer.appendChild(messageElement);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// --- Event Listeners ---
processButton.addEventListener('click', handleProcessArticle);
fileInput.addEventListener('change', handleFileSelect);
reviewForm.addEventListener('submit', handleGenerateReview);
draftVersionControls.addEventListener('click', handleVersionChange);
analyzeTextButton.addEventListener('click', handleAnalyzeText);
similarityCheckButton.addEventListener('click', handleSimilarityCheck);
suggestionsPanel.addEventListener('click', handleSuggestionClick);
chatForm.addEventListener('submit', handleAskQuestion);

writingEditor.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    hideSimilarityTooltip(); // Hide any existing tooltips
    if (target.classList.contains('similarity-highlight')) {
        showSimilarityTooltip(target);
    }
});
document.addEventListener('click', (e) => {
    const tooltip = document.getElementById('similarity-tooltip');
    if (tooltip && !tooltip.contains(e.target as Node) && !(e.target as HTMLElement).classList.contains('similarity-highlight')) {
        hideSimilarityTooltip();
    }
});


editorToolbar.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const button = target.closest('button');
    if (button && button.dataset.command) {
        document.execCommand(button.dataset.command, false);
        writingEditor.focus();
    }
});

// --- Initial UI State ---
setLoading(false);