# Sokoban solver

A push-optimal Sokoban solver for the make.fun bounty
`sokoban-solver-01-run-20261121`.

## How it works

The rooms of a level are independent: a box pushed through a door into the
hallway can never be pushed back, so every box stays in its room and the
level's push-optimal count P* is the sum of the rooms' optima. The program
therefore splits each level into its rooms (the hallway is the player's row;
removing it leaves one connected component per room), solves each room
push-optimally, and joins the rooms with the player's walk along the hallway.

Each room is solved with A* over pushes: a state is the room's boxes plus the
region the player can reach without pushing. The heuristic is the minimum
assignment of boxes to goals by grid distance (admissible: one push moves one
box one square). States are pruned by dead squares (a box on a square from
which no goal can ever be reached) and by 2x2 blocks of walls and boxes with
no goal. The search is budgeted by a fixed number of expansions, never by the
wall clock, so two executions write the same bytes.

## Results

- Practice set: **1,000,000** — every instance solved in exactly P* pushes
  (13, 16, 29, 47, 60), in about 0.7 s for the whole set.
- House baseline plain-astar 1.0.0 on the same set: **200,000** — it solves
  only the first instance and gives up on the other four.
- Four extra sets drawn with the kit generator from other seeds: **1,000,000**
  each, every instance at P*, each set in about 0.5 s.

## Run

```
node main.ts   # reads /input/<id>/level.txt, writes /output/<id>/solution.txt
```

Node 22, standard library only, no dependencies. `MAKEFUN_INPUT_DIR` and
`MAKEFUN_OUTPUT_DIR` override the input and output directories (as in the
kit's starter).
