# GPTCalculator

## About
This is a GPT assisted calculator utilizing React for the frontend and a javascript backend. For the mathematical computation, I am using math.js. When AI mode is enabled, the equation or phrase will be converted into numerical and symbolic form and then computed with math.js. For example, the phrase "Add five hundred and seven to 15" will convert to "507 + 15" and then computed using math.js. 

## Instructions
As this project is not yet deployed, a .env file will need to be added with your own personal GPT API key, and the server and client need to both be run locally. Your .env file will need to be added under the server folder. Then, open two terminals. One within the server folder and another in the client folder. First, run the server with 'npm run dev'. This will start the server and allow for the use of AI mode. Then run the client with 'npm run dev'. This will start the client itself, which will be open to the local host link provided when the command is run.

Once in the program, if the question mark button next to the title is clicked, an assit tab will appear that will provide the syntax to enter equations. 