import React, { useState } from 'react';
import { Upload, FileSpreadsheet, Send, CheckCircle2, AlertCircle, Loader2, X } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

import type { ChangeEvent, DragEvent } from 'react';

interface SelectedOptions {
	lacInfo: boolean;
	awareness: boolean;
	insagCneIf: boolean;
}

interface Status {
	type: 'error' | 'success' | '';
	message: string;
}

interface ProcessResponse {
	success?: boolean;
	filesProcessed?: number;
	error?: string;
	details?: string[];
}

const FileProcessor: React.FC = () => {
	const [files, setFiles] = useState<File[]>([]);
	const [selectedOptions, setSelectedOptions] = useState<SelectedOptions>({
		lacInfo: false,
		awareness: false,
		insagCneIf: false,
	});
	const [processing, setProcessing] = useState<boolean>(false);
	const [status, setStatus] = useState<Status>({ type: '', message: '' });
	const [email, setEmail] = useState<string>('');
	const [progress, setProgress] = useState<string>('');

	const API_URL = 'http://localhost:3001';

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
		const validFiles = droppedFiles.filter(
			(file) => file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.name.endsWith('.csv')
		);
		setFiles((prevFiles) => [...prevFiles, ...validFiles]);
	};

	const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
		e.preventDefault();
	};

	const removeFile = (index: number) => {
		setFiles((prevFiles) => prevFiles.filter((_, i) => i !== index));
	};

	const handleOptionChange = (option: keyof SelectedOptions) => {
		setSelectedOptions((prev) => ({
			...prev,
			[option]: !prev[option],
		}));
	};

	const handleProcess = async () => {
		if (files.length === 0) {
			setStatus({ type: 'error', message: 'Please upload at least one file' });
			return;
		}

		if (!Object.values(selectedOptions).some((v) => v)) {
			setStatus({ type: 'error', message: 'Please select at least one processing option' });
			return;
		}

		if (!email || !email.includes('@')) {
			setStatus({ type: 'error', message: 'Please enter a valid email address' });
			return;
		}

		setProcessing(true);
		setStatus({ type: '', message: '' });
		setProgress('Preparing files...');

		const formData = new FormData();
		files.forEach((file) => {
			formData.append('files', file);
		});
		formData.append('options', JSON.stringify(selectedOptions));
		formData.append('email', email);

		try {
			setProgress('Processing files...');
			const response = await fetch(`${API_URL}/api/process`, {
				method: 'POST',
				body: formData,
			});

			const result: ProcessResponse = await response.json();

			if (response.ok && result.filesProcessed) {
				setStatus({
					type: 'success',
					message: `Files processed successfully! ${result.filesProcessed} file(s) have been sent to ${email}`,
				});
				setFiles([]);
				setSelectedOptions({
					lacInfo: false,
					awareness: false,
					insagCneIf: false,
				});
				setEmail('');
			} else {
				setStatus({ type: 'error', message: result.error || 'Processing failed' });
			}
		} catch (error) {
			console.error('Error:', error);
			setStatus({ type: 'error', message: 'Network error. Please check your connection and try again.' });
		} finally {
			setProcessing(false);
			setProgress('');
		}
	};

	const selectedCount = Object.values(selectedOptions).filter((v) => v).length;

	return (
		<div className='min-h-screen bg-gray-50 py-8'>
			<div className='max-w-4xl mx-auto px-4'>
				<div className='bg-white rounded-lg shadow-lg p-8'>
					<h1 className='text-3xl font-bold text-gray-900 mb-2'>Excel/CSV File Processor</h1>
					<p className='text-gray-600 mb-8'>Process and transform your Excel/CSV files automatically</p>

					{/* File Upload Section */}
					<div className='mb-8'>
						<label className='block text-sm font-medium text-gray-700 mb-4'>
							Upload Files ({files.length} selected)
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
									<p className='text-xs text-gray-500'>Excel (.xlsx, .xls) or CSV files</p>
									<p className='text-xs text-gray-400 mt-1'>Multiple files supported</p>
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
								<h3 className='text-sm font-medium text-gray-700 mb-2'>Uploaded Files:</h3>
								<ul className='space-y-2'>
									{files.map((file, index) => (
										<li
											key={index}
											className='flex items-center justify-between text-sm text-gray-600 bg-gray-50 p-2 rounded'>
											<div className='flex items-center'>
												<FileSpreadsheet className='w-4 h-4 mr-2 text-gray-500' />
												<span>{file.name}</span>
												<span className='text-xs text-gray-400 ml-2'>
													({(file.size / 1024).toFixed(1)} KB)
												</span>
											</div>
											<button
												onClick={() => removeFile(index)}
												className='text-red-500 hover:text-red-700'
												type='button'>
												<X className='w-4 h-4' />
											</button>
										</li>
									))}
								</ul>
							</div>
						)}
					</div>

					{/* Processing Options */}
					<div className='mb-8'>
						<h2 className='text-lg font-medium text-gray-900 mb-4'>
							Processing Options{' '}
							{selectedCount > 0 && <span className='text-sm text-gray-500'>({selectedCount} selected)</span>}
						</h2>
						<div className='space-y-3'>
							<label className='flex items-start space-x-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 transition-colors'>
								<input
									type='checkbox'
									className='w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 mt-0.5'
									checked={selectedOptions.lacInfo}
									onChange={() => handleOptionChange('lacInfo')}
								/>
								<div>
									<span className='text-gray-700 font-medium'>LAC Info Processing</span>
									<p className='text-xs text-gray-500 mt-1'>
										Standardizes license names and formats data for IFAG
									</p>
								</div>
							</label>

							<label className='flex items-start space-x-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 transition-colors'>
								<input
									type='checkbox'
									className='w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 mt-0.5'
									checked={selectedOptions.awareness}
									onChange={() => handleOptionChange('awareness')}
								/>
								<div>
									<span className='text-gray-700 font-medium'>Awareness Processing</span>
									<p className='text-xs text-gray-500 mt-1'>
										Cleans phone numbers and standardizes formation names
									</p>
								</div>
							</label>

							<label className='flex items-start space-x-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 transition-colors'>
								<input
									type='checkbox'
									className='w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 mt-0.5'
									checked={selectedOptions.insagCneIf}
									onChange={() => handleOptionChange('insagCneIf')}
								/>
								<div>
									<span className='text-gray-700 font-medium'>Insag CNE IF Processing</span>
									<p className='text-xs text-gray-500 mt-1'>Adds CRM columns and product mappings</p>
								</div>
							</label>
						</div>
					</div>

					{/* Email Input */}
					<div className='mb-8'>
						<label className='block text-sm font-medium text-gray-700 mb-2'>
							Email Address <span className='text-red-500'>*</span>
						</label>
						<input
							type='email'
							className='w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors'
							placeholder='Enter email to receive processed files'
							value={email}
							onChange={(e) => setEmail(e.target.value)}
						/>
						<p className='text-xs text-gray-500 mt-1'>Processed files will be sent to this email address</p>
					</div>

					{/* Status Messages */}
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
							</AlertDescription>
						</Alert>
					)}

					{/* Progress indicator */}
					{progress && <div className='mb-4 text-sm text-gray-600 text-center'>{progress}</div>}

					{/* Process Button */}
					<button
						onClick={handleProcess}
						disabled={processing || files.length === 0}
						type='button'
						className='w-full flex items-center justify-center px-4 py-3 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors'>
						{processing ? (
							<>
								<Loader2 className='animate-spin -ml-1 mr-2 h-4 w-4' />
								Processing...
							</>
						) : (
							<>
								<Send className='-ml-1 mr-2 h-4 w-4' />
								Process and Send via Email
							</>
						)}
					</button>
				</div>

				{/* Quick Info */}
				<div className='mt-8 bg-blue-50 rounded-lg p-6'>
					<h2 className='text-lg font-semibold text-blue-900 mb-3'>How it works</h2>
					<ol className='list-decimal list-inside space-y-2 text-sm text-blue-800'>
						<li>Upload one or more Excel/CSV files</li>
						<li>Select the processing options you need</li>
						<li>Enter the email address to receive processed files</li>
						<li>Click "Process and Send" - files will be processed and emailed</li>
					</ol>
				</div>
			</div>
		</div>
	);
};

export default FileProcessor;
