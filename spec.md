# Batch processing  AI image generation
A browser based locally run application to store an api key during the session, generate images using an AI image generation service. Supports OpenAI and Gemini. 

## Features
- A drop down key pair for the AI Service provider along with the key (required).
  - Example:
  - ......................
    | OpenAI | key*******|
    ......................
- Upload reference image(s)
- Prompt (required), with a `GO` button to start the batch processing
- Progress bar to show the client (user) how many images(s) are processed, and how many remain.
- Read and Write to a local directory of user's choice. All generated images are automatically saved to the local directory on the machine.

## User Work flow
1. User opens the application
2. User is requird to put in an API key
3. Application is required to fetch all the available models for use as per the API service provider selected by the user.
4. User may upload image reference(s)
5. User is required to put in a prompt
6. The batch API is required to understand how many images to generate and generate them as required
7. User may check the progress bar

## Application
### Screen 1
- The following features occupy Screen 1
  > The API service provider along with API Key (required)
  > Feature that allows reference image uploads (optional)
  > What API model to use
  > Estimated cost of the batch request(s)
  > Where to save the output file(s) (required)
  > Text space for prompt with a `GO` button (required)
### Screen 2
- Screen 2 loads only when all conditions above are satisfied
  > Progress bar to show how many images are created
  > Once all the images are created (successfully / failed), replace the progress bar with text `task completed`
