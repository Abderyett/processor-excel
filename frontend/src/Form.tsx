import React, { useState } from 'react';
import {
	Upload,
	FileSpreadsheet,
	Send,
	CheckCircle2,
	AlertCircle,
	Loader2,
	X,
	GitCompare,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

import type { ChangeEvent, DragEvent } from 'react';

interface SelectedOptions {
	lacInfo: boolean;
	awareness: boolean;
	insagCneIf: boolean;
	compareAndClean: boolean;
}

interface Status {
	type: 'error' | 'success' | '';
	message: string;
	extra?: string[]; // optional extra details for success
}

/**
 * Matches the updated backend JSON shape returned by /api/process
 */
interface ProcessResponse {
	success?: boolean;
	filesProcessed?: number;
	totalDuplicatesRemoved?: number;
	error?: string;
	details?: string[]; // each element already formatted as text, eg. "LAC Info: 123 rows (4 duplicates removed)"
	isCompareAndClean?: boolean;
}

const FileProcessor: React.FC = () => {
	const [files, setFiles] = useState<File[]>([]);
	const [selectedOptions, setSelectedOptions] = useState<SelectedOptions>({
		lacInfo: false,
		awareness: false,
		insagCneIf: false,
		compareAndClean: false,
	});
	const [processing, setProcessing] = useState<boolean>(false);
	const [status, setStatus] = useState<Status>({ type: '', message: '' });
	const [email, setEmail] = useState<string>('');
	const [progress, setProgress] = useState<string>('');

	// 👉  UPDATE HERE if you deploy the API somewhere else
	const API_URL = 'https://node-processor.vispera-dz.com';

	/* ────────────────────────────────  File handlers  */
	const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
		if (e.target.files) {
			const uploadedFiles = Array.from(e.target.files);
			setFiles((prevFiles) => [...prevFiles, ...uploadedFiles]);
			setStatus({ type: '', message: '' });
		}
	};

	const handleDrop = (e: DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		const droppedFiles = Array.from(e.dataTransfer.files);
		const validFiles = droppedFiles.filter((file) => /(xlsx?|csv)$/i.test(file.name));
		setFiles((prevFiles) => [...prevFiles, ...validFiles]);
	};

	const handleDragOver = (e: DragEvent<HTMLDivElement>) => e.preventDefault();

	const removeFile = (index: number) => {
		setFiles((prevFiles) => prevFiles.filter((_, i) => i !== index));
	};

	/* ────────────────────────────────  Option toggles  */
	const handleOptionChange = (option: keyof SelectedOptions) => {
		setSelectedOptions((prev) => {
			const newOptions = { ...prev, [option]: !prev[option] };

			// If Compare and Clean is selected, deselect other options
			if (option === 'compareAndClean' && !prev[option]) {
				return {
					lacInfo: false,
					awareness: false,
					insagCneIf: false,
					compareAndClean: true,
				};
			}

			// If any other option is selected while Compare and Clean is active, deselect Compare and Clean
			if (option !== 'compareAndClean' && prev.compareAndClean && !prev[option]) {
				newOptions.compareAndClean = false;
			}

			return newOptions;
		});
	};

	/* ────────────────────────────────  Process files  */
	const handleProcess = async () => {
		if (files.length === 0) {
			setStatus({ type: 'error', message: 'Please upload at least one file' });
			return;
		}

		// Special validation for Compare and Clean
		if (selectedOptions.compareAndClean && files.length !== 2) {
			setStatus({ type: 'error', message: 'Compare and Clean requires exactly 2 files' });
			return;
		}

		if (!Object.values(selectedOptions).some(Boolean)) {
			setStatus({ type: 'error', message: 'Please select at least one processing option' });
			return;
		}
		if (!email || !email.includes('@')) {
			setStatus({ type: 'error', message: 'Please enter a valid email address' });
			return;
		}

		setProcessing(true);
		setStatus({ type: '', message: '' });
		setProgress('Uploading files...');

		/* Build multipart FormData */
		const formData = new FormData();
		files.forEach((file) => formData.append('files', file));
		formData.append('options', JSON.stringify(selectedOptions));
		formData.append('email', email);

		try {
			setProgress('Processing files on server...');
			const response = await fetch(`${API_URL}/api/process`, {
				method: 'POST',
				body: formData,
			});

			const result: ProcessResponse = await response.json();

			if (response.ok && result.success) {
				/* Build success message */
				const baseMsg = `${result.filesProcessed} processed file${
					result.filesProcessed === 1 ? '' : 's'
				} sent to ${email}.`;
				const dupMsg =
					result.totalDuplicatesRemoved && result.totalDuplicatesRemoved > 0
						? ` (${result.totalDuplicatesRemoved} duplicates removed).`
						: '';
				setStatus({ type: 'success', message: baseMsg + dupMsg, extra: result.details });
				// Clear inputs
				setFiles([]);
				setSelectedOptions({ lacInfo: false, awareness: false, insagCneIf: false, compareAndClean: false });
				setEmail('');
			} else {
				setStatus({ type: 'error', message: result.error || 'Processing failed' });
			}
		} catch (err) {
			console.error(err);
			setStatus({ type: 'error', message: 'Network error. Please try again.' });
		} finally {
			setProcessing(false);
			setProgress('');
		}
	};

	/* ────────────────────────────────  Derived values  */
	const selectedCount = Object.values(selectedOptions).filter(Boolean).length;
	const isCompareAndCleanSelected = selectedOptions.compareAndClean;

	/* ────────────────────────────────  Render  */
	return (
		<div className='min-h-screen bg-gray-50 py-8'>
			<div className='max-w-4xl mx-auto px-4'>
				<div className='bg-white rounded-lg shadow-lg p-8'>
					<h1 className='text-3xl font-bold text-gray-900 mb-2'>Excel/CSV File Processor</h1>
					<p className='text-gray-600 mb-8'>Process and transform your Excel/CSV files automatically 🪄</p>

					{/* ───────────────  File upload  */}
					<div className='mb-8'>
						<label className='block text-sm font-medium text-gray-700 mb-4'>
							Upload Files ({files.length} selected)
							{isCompareAndCleanSelected && (
								<span className='ml-2 text-blue-600 text-xs'>
									• Exactly 2 files required for Compare & Clean
								</span>
							)}
						</label>

						<div
							onDrop={handleDrop}
							onDragOver={handleDragOver}
							className='flex items-center justify-center w-full'>
							<label className='flex flex-col items-center justify-center w-full h-64 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100 transition-colors'>
								<div className='flex flex-col items-center justify-center pt-5 pb-6'>
									<Upload className='w-10 h-10 mb-3 text-gray-400' />
									<p className='mb-2 text-sm text-gray-500'>
										<span className='font-semibold'>Click to upload</span> or drag and drop
									</p>
									<p className='text-xs text-gray-500'>
										Excel (.xlsx, .xls) or CSV files • up to 50&nbsp;MB each
									</p>
									<p className='text-xs text-gray-400 mt-1'>
										{isCompareAndCleanSelected
											? 'Upload exactly 2 files to compare'
											: 'Multiple files supported'}
									</p>
								</div>
								<input
									type='file'
									className='hidden'
									multiple
									accept='.xlsx,.xls,.csv'
									onChange={handleFileUpload}
								/>
							</label>
						</div>

						{files.length > 0 && (
							<div className='mt-4 max-h-40 overflow-y-auto'>
								<h3 className='text-sm font-medium text-gray-700 mb-2'>
									Uploaded Files:
									{isCompareAndCleanSelected && files.length === 2 && (
										<span className='ml-2 text-green-600 text-xs'>✓ Ready for comparison</span>
									)}
									{isCompareAndCleanSelected && files.length !== 2 && (
										<span className='ml-2 text-amber-600 text-xs'>
											{files.length < 2
												? `Need ${2 - files.length} more file(s)`
												: 'Too many files - remove some'}
										</span>
									)}
								</h3>
								<ul className='space-y-2'>
									{files.map((file, idx) => (
										<li
											key={idx}
											className='flex items-center justify-between text-sm text-gray-600 bg-gray-50 p-2 rounded'>
											<div className='flex items-center'>
												<FileSpreadsheet className='w-4 h-4 mr-2 text-gray-500' />
												<span>{file.name}</span>
												<span className='text-xs text-gray-400 ml-2'>
													({(file.size / 1024).toFixed(1)} KB)
												</span>
											</div>
											<button
												type='button'
												onClick={() => removeFile(idx)}
												className='text-red-500 hover:text-red-700'>
												<X className='w-4 h-4' />
											</button>
										</li>
									))}
								</ul>
							</div>
						)}
					</div>

					{/* ───────────────  Processing options  */}
					<div className='mb-8'>
						<h2 className='text-lg font-medium text-gray-900 mb-4'>
							Processing Options{' '}
							{selectedCount > 0 && <span className='text-sm text-gray-500'>({selectedCount} selected)</span>}
						</h2>

						{/* Compare and Clean Option - Special styling */}
						<div
							className={`mb-4 p-4 rounded-lg border-2 ${
								isCompareAndCleanSelected ? 'border-blue-200 bg-blue-50' : 'border-gray-200'
							}`}>
							<label htmlFor='compareAndClean' className='flex items-start space-x-3 cursor-pointer'>
								<input
									id='compareAndClean'
									type='checkbox'
									className='w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 mt-0.5'
									checked={selectedOptions.compareAndClean}
									onChange={() => handleOptionChange('compareAndClean')}
								/>
								<div className='flex-1'>
									<div className='flex items-center'>
										<GitCompare className='w-4 h-4 mr-2 text-blue-600' />
										<span className='text-gray-700 font-medium'>Compare & Clean</span>
										<span className='ml-2 px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full'>
											NEW
										</span>
									</div>
									<p className='text-xs text-gray-600 mt-1'>
										Compares 2 files and removes duplicate email addresses from the newer file
									</p>
									<p className='text-xs text-blue-600 mt-1 font-medium'>
										⚠️ This option requires exactly 2 files and cannot be combined with other processing
										options
									</p>
								</div>
							</label>
						</div>

						{/* Regular processing options */}
						<div className={`space-y-1 ${isCompareAndCleanSelected ? 'opacity-50 pointer-events-none' : ''}`}>
							{(
								[
									{
										id: 'lacInfo',
										title: 'LAC Info Processing',
										desc: 'Standardises licence names and formats data for IFAG',
									},
									{
										id: 'awareness',
										title: 'Awareness Processing',
										desc: 'Cleans phone numbers and standardises formation names',
									},
									{
										id: 'insagCneIf',
										title: 'Insag CNE IF Gmba Processing',
										desc: 'Adds CRM columns and product mappings',
									},
								] as const
							).map((opt) => (
								<label
									key={opt.id}
									htmlFor={opt.id}
									className='flex items-start space-x-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 transition-colors'>
									<input
										id={opt.id}
										type='checkbox'
										className='w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 mt-0.5'
										checked={selectedOptions[opt.id] as boolean}
										onChange={() => handleOptionChange(opt.id)}
										disabled={isCompareAndCleanSelected}
									/>
									<div>
										<span className='text-gray-700 font-medium'>{opt.title}</span>
										<p className='text-xs text-gray-500 mt-1'>{opt.desc}</p>
									</div>
								</label>
							))}
						</div>

						{isCompareAndCleanSelected && (
							<p className='text-xs text-gray-500 mt-2 italic'>
								Other processing options are disabled when Compare & Clean is selected
							</p>
						)}
					</div>

					{/* ───────────────  Email  */}
					<div className='mb-8'>
						<label className='block text-sm font-medium text-gray-700 mb-2'>
							Email Address <span className='text-red-500'>*</span>
						</label>
						<input
							type='email'
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							placeholder='Enter email to receive processed files'
							className='w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors'
						/>
						<p className='text-xs text-gray-500 mt-1'>
							{isCompareAndCleanSelected
								? 'The cleaned file will be sent to this email address'
								: 'Processed files will be sent to this email address'}
						</p>
					</div>

					{/* ───────────────  Status messages  */}
					{status.message && (
						<Alert
							className={`mb-6 ${
								status.type === 'error' ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'
							}`}>
							{status.type === 'error' ? (
								<AlertCircle className='h-4 w-4 text-red-600' />
							) : (
								<CheckCircle2 className='h-4 w-4 text-green-600' />
							)}
							<AlertDescription className={status.type === 'error' ? 'text-red-800' : 'text-green-800'}>
								{status.message}
								{status.extra && status.extra.length > 0 && (
									<ul className='mt-2 list-disc list-inside text-xs space-y-1 text-green-700'>
										{status.extra.map((d, i) => (
											<li key={i}>{d}</li>
										))}
									</ul>
								)}
							</AlertDescription>
						</Alert>
					)}

					{/* ───────────────  Progress  */}
					{progress && <div className='mb-4 text-sm text-gray-600 text-center'>{progress}</div>}

					{/* ───────────────  CTA button  */}
					<button
						type='button'
						onClick={handleProcess}
						disabled={processing || files.length === 0 || (isCompareAndCleanSelected && files.length !== 2)}
						className='w-full flex items-center justify-center px-4 py-3 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors'>
						{processing ? (
							<>
								<Loader2 className='animate-spin -ml-1 mr-2 h-4 w-4' />
								{isCompareAndCleanSelected ? 'Comparing and Cleaning...' : 'Processing…'}
							</>
						) : (
							<>
								<Send className='-ml-1 mr-2 h-4 w-4' />
								{isCompareAndCleanSelected ? 'Compare, Clean & Send via Email' : 'Process and Send via Email'}
							</>
						)}
					</button>
				</div>

				{/* ───────────────  Quick info  */}
				<div className='mt-8 bg-blue-50 rounded-lg p-6'>
					<h2 className='text-lg font-semibold text-blue-900 mb-3'>How it works</h2>
					{isCompareAndCleanSelected ? (
						<ol className='list-decimal list-inside space-y-2 text-sm text-blue-800'>
							<li>Upload exactly 2 Excel/CSV files with email addresses.</li>
							<li>The system will automatically determine which file is newer based on filename dates.</li>
							<li>All email addresses from the older file will be compared against the newer file.</li>
							<li>Duplicate email addresses will be removed from the newer file.</li>
							<li>
								The cleaned file will be sent to your email address with "_clean" added to the filename.
							</li>
						</ol>
					) : (
						<ol className='list-decimal list-inside space-y-2 text-sm text-blue-800'>
							<li>Upload one or more Excel/CSV files.</li>
							<li>Select the processing options you need.</li>
							<li>Enter the email address to receive processed files.</li>
							<li>Click "Process and Send" – the files will be processed and emailed to you.</li>
						</ol>
					)}
				</div>
			</div>
		</div>
	);
};

export default FileProcessor;
