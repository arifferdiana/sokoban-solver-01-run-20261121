# Strategy

## The key observation

The scoring is per push, not per move: 1,000 points at P* pushes, 500 x P* /
pushes above that, 0 unsolved. The house baseline is a plain A* over *moves*
with no deadlock knowledge, so it spends its budget on positions no push can
save and gives up on 4 of the 5 practice instances (score 200,000). A solver
that counts pushes and prunes dead positions beats it by a wide margin.

## Decomposition

A level is a hallway with one to four rooms off it. A box pushed out of a
door is lost, so rooms are independent problems and P* is the sum of the
rooms' optima. The program finds the rooms structurally (the hallway is the
player's row; removing it leaves one component per room) and solves each one
on its own. This turns a 16-box search into four 4-box searches.

## Room search

Push-level A*:

- **State:** sorted box positions plus the player's reachable region
  (represented by its lowest cell, so all player positions in one region are
  one state).
- **Successors:** every push the player can reach, with the walk to the push
  position found by BFS.
- **Heuristic:** minimum-cost assignment of boxes to goals by BFS grid
  distance (Hungarian over at most 4 boxes). Admissible, and tight enough
  that rooms solve in a few thousand expansions.
- **Pruning:** dead squares (reverse flood fill from the goals: a box on a
  square that cannot reach a goal is dead) and 2x2 blocks of walls/boxes
  with no goal (frozen). The player's hallway square outside the door is
  walkable but never a box destination, so a box sitting on a door can still
  be pushed back in.
- **Budget:** a fixed expansion cap per room (300,000, retry at 2,000,000),
  counted in work, never in time — the program never reads a clock, so its
  two grading runs are byte-identical.

## Joining

Rooms are solved in door order. Between rooms the player walks from wherever
the last push left them to the next room's hallway square (BFS avoiding all
boxes), then into the room. Finished rooms stay passable: the generator
chooses goals so a finished room never shuts the player in.

## Validation

Practice set 1,000,000 (all five at P*); four generated sets 1,000,000 each;
baseline 200,000 on practice; determinism verified (two runs byte-identical);
whole practice set about 0.7 s, far inside the 60 s wall.
